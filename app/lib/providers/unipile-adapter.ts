import { createHash, randomBytes } from "node:crypto";
import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { normalizeLinkedIn, normalizePhone } from "../../app/contacts/contact-utils";
import { advanceParticipantToNextStep } from "../campaign-execution/step-progression";
import type { WorkspaceContext } from "../workspace-context";
import {
  channelForProvider,
  editChatMessage,
  getUnipileConfig,
  listChatAttendees,
  listChatMessages,
  listChats,
  sendChatMessage,
  toConnectionStatus,
  type UnipileAccountStatusPayload,
  type UnipileAttachment,
  type UnipileHostedAuthNotifyPayload,
  type UnipileNewMessagePayload,
} from "./unipile";

// Compact, storage-shaped attachment record — never the raw Unipile `url`
// (it can expire, and callers must always go through the attachment-proxy
// route so UNIPILE_API_KEY never has to leave the server). One row per
// attachment, keyed by messageId+attachmentId at render time.
export type NormalizedAttachment = {
  id: string;
  type: UnipileAttachment["type"];
  mimetype?: string;
  fileSize?: number;
  fileName?: string;
  width?: number;
  height?: number;
  duration?: number;
  voiceNote?: boolean;
};

function normalizeAttachments(raw: UnipileAttachment[] | undefined): NormalizedAttachment[] {
  if (!raw?.length) return [];
  return raw.filter((item) => !item.unavailable).map((item) => ({
    id: item.id,
    type: item.type,
    mimetype: item.mimetype,
    fileSize: item.file_size,
    fileName: item.file_name,
    width: item.size?.width,
    height: item.size?.height,
    duration: item.duration,
    voiceNote: item.voice_note,
  }));
}

// Normalizes raw Unipile webhook payloads into Talvia's own entities
// (Connections, Contacts, Contact Identities, Conversations, Messages,
// Activities) per the provider adapter pattern in ARCHITECTURE.md §3.
// Nothing outside this file should know Unipile's payload shapes.

const PROVIDER = "unipile";

function splitDisplayName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

const AUTH_ATTEMPT_TTL_MS = 30 * 60 * 1000; // matches createHostedAuthLink's own expiresOn window

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- Historical sync job state (connections.metadata.sync) ---
// Persisted job state for the durable, cron-driven historical backfill —
// see runDueConnectionSyncs below. Deliberately reuses the existing
// connections.metadata jsonb column instead of a new table: connections
// already IS the source of truth for the connected account
// (ARCHITECTURE.md §3), and a single jsonb_set on the 'sync' key never
// touches any other property that may already live in metadata.
export type ConnectionSyncState = {
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  chatsProcessed: number;
  // Every message the batch upsert wrote a row for — a fresh INSERT or an
  // existing row's DO UPDATE both count. On a first backfill (the common
  // case) this equals "new messages"; on a resync it also counts messages
  // that already existed and were re-verified/corrected. Never described as
  // "new inserts only" anywhere this value is surfaced.
  messagesImported: number;
  chatsSkippedGroups: number;
  chatsFailed: number;
  error: string | null;
};

const INITIAL_SYNC_STATE: ConnectionSyncState = {
  status: "pending", startedAt: null, heartbeatAt: null, completedAt: null,
  chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: null,
};

// Same 10-minute threshold already established for campaign participant
// claims (campaign-execution/executor-shared.ts's CLAIM_STALE_AFTER) — kept
// as a separate local constant rather than a cross-domain import, since it's
// a single literal shared only by convention, not by coupling.
const SYNC_STALE_AFTER = "10 minutes";

async function writeSyncState(connectionId: string, state: ConnectionSyncState): Promise<void> {
  await database.query(
    `update connections set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{sync}',$2::jsonb),updated_at=now() where id=$1`,
    [connectionId, JSON.stringify(state)],
  );
}

// Closes a real concurrency gap without a lease system or a curseur
// checkpoint: backfillConnectionHistory only refreshed the heartbeat once
// per CHAT, but one chat can itself page through hundreds/thousands of
// messages — a single huge chat could keep a live backfill's heartbeat
// unrefreshed past SYNC_STALE_AFTER, making runDueConnectionSyncs wrongly
// reclaim it while it's still actively progressing. Called once per message
// page actually fetched inside backfillChat (below) — a targeted single-key
// jsonb_set that touches only metadata.sync.heartbeatAt, leaving every other
// key (counters, other metadata) untouched.
async function touchSyncHeartbeat(connectionId: string): Promise<void> {
  await database.query(
    `update connections set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{sync,heartbeatAt}',$2::jsonb) where id=$1`,
    [connectionId, JSON.stringify(new Date().toISOString())],
  );
}

// Fires from ingestHostedAuthNotification and ingestAccountStatus — the two
// places a connection's status can genuinely become 'connected' — right
// after that write. Guarded atomically on `metadata->'sync' is null` so a
// webhook redelivery (status already 'connected' from a prior call) can
// never reinitialize a sync that is already running/completed/failed; it
// only ever fires once, on the connection's first real transition. Scoped to
// WhatsApp only — LinkedIn already has its own established manual-sync-only
// flow and this must not silently change that shipped behavior.
async function initializeAutoSyncIfNeeded(connectionId: string | undefined, channelType: string, status: string): Promise<void> {
  if (!connectionId || status !== "connected" || channelType !== "whatsapp") return;
  await database.query(
    `update connections set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{sync}',$2::jsonb) where id=$1 and metadata->'sync' is null`,
    [connectionId, JSON.stringify(INITIAL_SYNC_STATE)],
  );
}

// Message status only ever advances forward: sent/received/pending/draft (0)
// -> delivered (1) -> read (2), never backward. Both the real-time
// delivery-receipt path (ingestMessageStatusUpdate) and the historical
// backfill upsert (backfillChat) compare through this exact rank expression
// so there is one definition of the ordering, not two.
function statusRankSql(column: string): string {
  return `(case ${column} when 'read' then 2 when 'delivered' then 1 else 0 end)`;
}

export type ConnectionAuthAttempt = { workspaceId: string; channelType: "linkedin" | "whatsapp" | "gmail" };

// Minted once per POST /api/connections/[channel]/connect, before Unipile
// is ever called — this is the ONLY safe place workspace/channel context for
// a brand-new hosted-auth connection can come from (an AccountStatus webhook
// event later never carries it — see ingestAccountStatus below). 32 random
// bytes, base64url-encoded: only its SHA-256 hash is persisted, never the
// raw value — the raw token exists only in memory here and in the
// notify_url handed to Unipile.
export async function createConnectionAuthAttempt(workspaceId: string, channelType: "linkedin" | "whatsapp" | "gmail"): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_ATTEMPT_TTL_MS).toISOString();
  await database.query(
    `insert into connection_auth_attempts(workspace_id,channel_type,token_hash,expires_at) values($1,$2,$3,$4)`,
    [workspaceId, channelType, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

// Resolves a notify_url token back to its workspace/channel — the
// correlation the hosted-auth flow needs, without ever trusting a bare
// AccountStatus payload to guess one (docs spec, explicit constraint).
//
// Exact semantics: the token binds PERMANENTLY to whichever account_id
// first resolves it successfully.
//   - first call, token T + account A  -> binds T to A, succeeds
//   - redelivery,  token T + account A -> already bound to A, succeeds
//     (idempotent — Unipile's webhook delivery is at-least-once, a
//     legitimate retry must not fail)
//   - token T + a DIFFERENT account B  -> rejected, T stays bound to A
// This is a single atomic UPDATE, not a check-then-update: the WHERE clause
// itself is the compare-and-set (`external_account_id is null or
// external_account_id=$2`), so Postgres's row-level lock on that UPDATE
// serializes two concurrent callbacks for different account_ids — the
// second one blocks until the first commits, then re-evaluates its own
// WHERE clause against the now-committed value and correctly fails to
// match. No separate SELECT-then-UPDATE race window exists.
export async function resolveConnectionAuthAttempt(token: string, accountId: string): Promise<ConnectionAuthAttempt | null> {
  const tokenHash = hashToken(token);
  const result = await database.query<{ workspace_id: string; channel_type: string }>(
    `update connection_auth_attempts
     set external_account_id=coalesce(external_account_id,$2), consumed_at=now()
     where token_hash=$1 and expires_at>now() and (external_account_id is null or external_account_id=$2)
     returning workspace_id,channel_type`,
    [tokenHash, accountId],
  );
  const row = result.rows[0];
  if (!row) return null; // unknown token, expired, or already bound to a different account_id
  if (row.channel_type !== "linkedin" && row.channel_type !== "whatsapp" && row.channel_type !== "gmail") return null;
  return { workspaceId: row.workspace_id, channelType: row.channel_type };
}

// The hosted auth flow's one-time confirmation: this is where we first learn
// which account_id Unipile assigned. `context` — resolved by the caller via
// resolveConnectionAuthAttempt, from the token on the request, not from this
// payload — is the authoritative source of workspace/channel. `payload.name`
// is still echoed by Unipile per its docs and cross-checked as a sanity
// signal only; a mismatch is logged, never trusted over the token.
export async function ingestHostedAuthNotification(payload: UnipileHostedAuthNotifyPayload, context: ConnectionAuthAttempt) {
  const { workspaceId, channelType: channel } = context;
  if (payload.name && payload.name !== `${workspaceId}::${channel}`) {
    console.error(`[unipile-adapter] ingestHostedAuthNotification: name mismatch — token resolved to workspace=${workspaceId} channel=${channel}, payload.name was "${payload.name}"`);
  }
  const status = toConnectionStatus(payload.status);
  const result = await database.query(
    `insert into connections(workspace_id,provider,channel_type,external_account_id,display_name,status,connected_at,last_synced_at)
     values($1,$2,$3,$4,$5,$6,case when $6::varchar='connected' then now() else null end,case when $6::varchar='connected' then now() else null end)
     on conflict(workspace_id,provider,external_account_id) do update set
       status=excluded.status,
       connected_at=case when excluded.status='connected' then now() else connections.connected_at end,
       last_synced_at=case when excluded.status='connected' then now() else connections.last_synced_at end
     returning id`,
    [workspaceId, PROVIDER, channel, payload.account_id, channel === "gmail" ? "Gmail" : channel === "linkedin" ? "LinkedIn" : "WhatsApp", status],
  );
  console.log(`[unipile-adapter] ingestHostedAuthNotification: workspace=${workspaceId} channel=${channel} account_id=${payload.account_id} status=${status} connection_id=${result.rows[0]?.id}`);
  await initializeAutoSyncIfNeeded(result.rows[0]?.id, channel, status);
}

// Ongoing lifecycle events for an already-connected account (no workspace
// hint in the payload — must already have a connections row for account_id).
// Deliberately UPDATE-only: an AccountStatus payload carries no workspace
// context to safely create a row from (docs spec — never guess a workspace).
//
// Channel/provider consistency: the hosted-auth-notify payload that CREATES
// a connection (ingestHostedAuthNotification, above) carries no
// account_type field at all — per Unipile's documented payload, there is
// nothing to cross-check at that stage, so `channel_type` on a newly created
// connection is guaranteed correct only by construction (it is always
// `attempt.channelType`, resolved server-side from Talvia's own token —
// never read from anything Unipile sends). AccountStatus, on the other
// hand, DOES carry `account_type` — the one place in this whole flow such a
// check is actually possible — so it's applied here, before ever touching
// an existing connection's status.
export async function ingestAccountStatus(payload: UnipileAccountStatusPayload["AccountStatus"]) {
  const existing = await database.query<{ id: string; channel_type: string }>(
    `select id,channel_type from connections where provider=$1 and external_account_id=$2`,
    [PROVIDER, payload.account_id],
  );
  const row = existing.rows[0];
  if (!row) {
    console.error(`[unipile-adapter] ingestAccountStatus: no existing connection for account_id=${payload.account_id} — nothing updated (a connection can only be created by ingestHostedAuthNotification)`);
    return;
  }
  const reportedChannel = channelForProvider(payload.account_type);
  if (reportedChannel && reportedChannel !== row.channel_type) {
    console.error(`[unipile-adapter] ingestAccountStatus: account_type mismatch for connection ${row.id} — stored channel_type=${row.channel_type}, payload reported account_type=${payload.account_type} — update skipped`);
    return;
  }
  const status = toConnectionStatus(payload.message);
  const result = await database.query(
    `update connections set status=$1,
       connected_at=case when $1::varchar='connected' then now() else connected_at end,
       last_synced_at=case when $1::varchar='connected' then now() else last_synced_at end,
       updated_at=now()
     where id=$2
     returning id`,
    [status, row.id],
  );
  console.log(`[unipile-adapter] ingestAccountStatus: account_id=${payload.account_id} updated, connection_id=${result.rows[0]?.id}`);
  await initializeAutoSyncIfNeeded(result.rows[0]?.id, row.channel_type, status);
}

// contact_identities.channel_type only accepts ('linkedin','whatsapp','email',
// 'instagram','other') — connections.channel_type can only validly be
// 'linkedin' or 'whatsapp' today (a 'gmail' hosted-auth connection fails its
// own check constraint before it ever gets this far — a Connections-side
// bug, out of scope for this pass). Anything unexpected falls back to
// 'other' rather than crashing on a constraint violation.
function toContactChannelType(channelType: string): "linkedin" | "whatsapp" | "other" {
  return channelType === "linkedin" || channelType === "whatsapp" ? channelType : "other";
}

// Dedup key matches the one contacts.ts already uses for manually-entered
// and CSV-imported contacts (workspace_id, channel_type, identifier_normalized)
// — a LinkedIn profile discovered via Unipile resolves to the same Contact as
// one a user already added by hand, instead of creating a duplicate.
//
// channelType was previously hardcoded to 'linkedin' here regardless of the
// connection's actual provider — since the webhook handler in ingestMessage
// is shared across every provider, an incoming WhatsApp message was silently
// filed under a 'linkedin' contact identity and run through LinkedIn's URL
// normalizer on what's actually a phone number. Fixed by threading the real
// channel type through from the connection row.
// Exported for reuse by app/lib/prospecting.ts, which needs the exact same
// dedup-by-contact_identities behavior for LinkedIn search candidates that
// get approved into real Contacts.
export async function findOrCreateContact(client: import("pg").PoolClient, workspaceId: string, channelType: string, providerId: string, profileUrl: string | undefined, displayName: string, avatarUrl?: string, occupation?: string) {
  const contactChannelType = toContactChannelType(channelType);
  const identifier = profileUrl || providerId;
  const identifierNormalized = contactChannelType === "linkedin"
    ? (profileUrl ? normalizeLinkedIn(profileUrl) : providerId)
    : contactChannelType === "whatsapp"
      ? normalizePhone(profileUrl || providerId)
      : (profileUrl || providerId).trim().toLowerCase();

  const existing = await client.query<{ contact_id: string }>(
    `select contact_id from contact_identities where workspace_id=$1 and channel_type=$3 and identifier_normalized=$2`,
    [workspaceId, identifierNormalized, contactChannelType],
  );
  if (existing.rows[0]) {
    // Contacts already imported before an avatar/headline was ever captured
    // (e.g. by the message webhook, which carries neither field) get them
    // attached the next time a resync sees it, instead of staying blank.
    if (avatarUrl) {
      await client.query(
        `update contact_identities set metadata=metadata||jsonb_build_object('avatarUrl',$3::text) where workspace_id=$1 and channel_type=$4 and identifier_normalized=$2`,
        [workspaceId, identifierNormalized, avatarUrl, contactChannelType],
      );
    }
    if (occupation) {
      // Never overwrite a job_title a human already typed in — LinkedIn's
      // "occupation" is a headline/pitch, not authoritative over that.
      await client.query(
        `update contacts set job_title=$2 where id=$1 and (job_title is null or job_title='')`,
        [existing.rows[0].contact_id, occupation],
      );
    }
    return existing.rows[0].contact_id;
  }

  const { firstName, lastName } = splitDisplayName(displayName || (contactChannelType === "whatsapp" ? "Contact WhatsApp" : "Contact"));
  const contact = await client.query<{ id: string }>(
    `insert into contacts(workspace_id,first_name,last_name,display_name,job_title,status) values($1,$2,$3,$4,$5,'new') returning id`,
    [workspaceId, firstName, lastName, displayName || "Contact sans nom", occupation ?? null],
  );
  const contactId = contact.rows[0]!.id;
  await client.query(
    `insert into contact_identities(workspace_id,contact_id,channel_type,provider,identifier,identifier_normalized,profile_url,metadata) values($1,$2,$8,$3,$4,$5,$6,$7)
     on conflict(workspace_id,channel_type,identifier_normalized) do nothing`,
    [workspaceId, contactId, PROVIDER, identifier, identifierNormalized, profileUrl ?? null, JSON.stringify({ unipileProviderId: providerId, ...(avatarUrl ? { avatarUrl } : {}) }), contactChannelType],
  );
  return contactId;
}

async function findOrCreateConversation(client: import("pg").PoolClient, workspaceId: string, connectionId: string, channelType: string, externalThreadId: string, contactId: string) {
  const existing = await client.query<{ id: string; contact_id: string | null }>(
    `select id,contact_id from conversations where connection_id=$1 and external_thread_id=$2`,
    [connectionId, externalThreadId],
  );
  if (existing.rows[0]) {
    // A thread found by a broken ingestion path in the past (e.g. an
    // undeployed fix still live in production) can be pinned to the wrong
    // Contact permanently otherwise — every later message just piles onto
    // whatever Contact got attached first. Reconcile it against the
    // counterparty this call actually resolved.
    if (existing.rows[0].contact_id !== contactId) {
      await client.query(`update conversations set contact_id=$2,updated_at=now() where id=$1`, [existing.rows[0].id, contactId]);
      if (existing.rows[0].contact_id) {
        await client.query(`delete from conversation_participants where conversation_id=$1 and contact_id=$2`, [existing.rows[0].id, existing.rows[0].contact_id]);
      }
      await client.query(
        `insert into conversation_participants(conversation_id,contact_id,external_participant_id,role) values($1,$2,$3,'sender')
         on conflict(conversation_id,external_participant_id) do nothing`,
        [existing.rows[0].id, contactId, contactId],
      );
    }
    return existing.rows[0].id;
  }

  const conversation = await client.query<{ id: string }>(
    `insert into conversations(workspace_id,connection_id,contact_id,channel_type,external_thread_id,status) values($1,$2,$3,$4,$5,'open') returning id`,
    [workspaceId, connectionId, contactId, channelType, externalThreadId],
  );
  const conversationId = conversation.rows[0]!.id;
  await client.query(
    `insert into conversation_participants(conversation_id,contact_id,external_participant_id,role) values($1,$2,$3,'sender')
     on conflict(conversation_id,external_participant_id) do nothing`,
    [conversationId, contactId, contactId],
  );
  return conversationId;
}

export type IngestResult = { status: "ingested" | "duplicate" | "unknown_account" };

type Attendee = NonNullable<UnipileNewMessagePayload["sender"]>;

// Unipile's webhook always reports `sender` as whoever actually sent the
// message — including when it's us. Comparing sender.attendee_provider_id
// against account_info.user_id (per Unipile's own docs) is the only way to
// tell an outbound message apart from an inbound one; get this wrong and
// every conversation's Contact ends up being the workspace's own LinkedIn
// identity instead of the person actually being talked to.
function resolveCounterparty(payload: UnipileNewMessagePayload): { attendee: Attendee; isOutbound: boolean } | null {
  const selfId = payload.account_info?.user_id;
  const isOutbound = Boolean(selfId && payload.sender?.attendee_provider_id === selfId);
  if (!isOutbound) return payload.sender ? { attendee: payload.sender, isOutbound: false } : null;
  const other = payload.attendees?.find((attendee) => attendee.attendee_provider_id !== selfId);
  return other ? { attendee: other, isOutbound: true } : null;
}

// "Was it delivered / seen" — the receipt only carries chat_id + message_id,
// no sender/attendee info, so this never touches Contact resolution at all,
// just moves an existing row forward in the pending -> sent -> delivered ->
// read progression. Guarded against regressing 'read' back to 'delivered'
// on an out-of-order redelivery.
async function ingestMessageStatusUpdate(payload: UnipileNewMessagePayload): Promise<IngestResult> {
  const status = payload.event === "message_read" ? "read" : "delivered";
  const result = await database.query<{ id: string }>(
    `update messages m set status=$1
     from conversations v, connections c
     where m.conversation_id=v.id and v.connection_id=c.id
       and c.provider=$2 and c.external_account_id=$3
       and v.external_thread_id=$4 and m.provider_message_id=$5
       and ${statusRankSql("m.status")} < ${statusRankSql("$1::varchar")}
     returning m.id`,
    [status, PROVIDER, payload.account_id, payload.chat_id, payload.message_id],
  );
  return { status: result.rows[0] ? "ingested" : "duplicate" };
}

// Idempotent by (conversation_id, provider_message_id) — a redelivered
// webhook for a message we already stored is a safe no-op, matching the
// same unique-constraint pattern createTestInbound() uses in lib/inbox.ts.
// Logs receipt + outcome only (account_id, resolved channel, ingested /
// duplicate / unknown_account) — never message body, phone number, token, or
// URL. This was the one gap identified in the prior audit turn: without it,
// there was no way to tell "webhook never arrived" from "arrived and was
// silently rejected" from "arrived and no-opped as a duplicate".
export async function ingestMessage(payload: UnipileNewMessagePayload): Promise<IngestResult> {
  console.log(`[unipile-adapter] ingestMessage: received event=${payload.event} account_id=${payload.account_id ?? "unknown"}`);
  const result = await ingestMessageBody(payload);
  console.log(`[unipile-adapter] ingestMessage: account_id=${payload.account_id ?? "unknown"} result=${result.status}`);
  return result;
}

async function ingestMessageBody(payload: UnipileNewMessagePayload): Promise<IngestResult> {
  if (payload.event === "message_read" || payload.event === "message_delivered") return ingestMessageStatusUpdate(payload);
  if (payload.event !== "message_received") return { status: "unknown_account" };
  const resolved = resolveCounterparty(payload);
  if (!resolved) return { status: "unknown_account" };
  const { attendee: counterparty, isOutbound } = resolved;

  const client = await database.connect();
  try {
    await client.query("begin");
    const connection = await client.query<{ id: string; workspace_id: string; channel_type: string }>(
      `select id,workspace_id,channel_type from connections where provider=$1 and external_account_id=$2`,
      [PROVIDER, payload.account_id],
    );
    if (!connection.rows[0]) {
      await client.query("rollback");
      return { status: "unknown_account" };
    }
    const { id: connectionId, workspace_id: workspaceId, channel_type: channelType } = connection.rows[0];

    const contactId = await findOrCreateContact(client, workspaceId, channelType, counterparty.attendee_provider_id, counterparty.attendee_profile_url, counterparty.attendee_name ?? "");
    const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, channelType, payload.chat_id, contactId);

    const direction = isOutbound ? "outbound" : "inbound";
    const status = isOutbound ? "sent" : "received";
    const attachments = normalizeAttachments(payload.attachments);
    const inserted = await client.query<{ id: string }>(
      `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at,metadata)
       values($1,$2,$3,$4,$5,$6,$7,case when $3::varchar='outbound' then now() else null end,case when $3::varchar='inbound' then now() else null end,$8)
       on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing
       returning id`,
      [workspaceId, conversationId, direction, isOutbound ? null : contactId, payload.message ?? "", status, payload.message_id, JSON.stringify(attachments.length ? { attachments } : {})],
    );
    if (!inserted.rows[0]) {
      await client.query("rollback");
      return { status: "duplicate" };
    }

    await client.query(`update conversations set last_message_at=now(),updated_at=now() where id=$1`, [conversationId]);
    const acceptedInvites = await markProspectingInvitesAccepted(client, workspaceId, contactId);
    // A genuine inbound reply — as opposed to the invitation-acceptance
    // message itself, which is excluded via acceptedInvites' ids — stops any
    // further automated Campaign action for this participant immediately,
    // server-side, regardless of whether the user has Inbox open
    // (docs/product/ARCHITECTURE.md §6, DECISIONS.md "LinkedIn campaign
    // behavior").
    const stoppedParticipants = isOutbound ? [] : await stopParticipantsOnReply(client, workspaceId, contactId, acceptedInvites.map((p) => p.id));
    // The acceptance advances the participant off the invite step, in the
    // SAME transaction as invite_accepted_at itself — a crash between the
    // two would otherwise leave a participant permanently stuck (accepted,
    // but never advanced). This is domain-state progression only, no
    // provider call: see step-progression.ts.
    const pendingActivities = [];
    for (const participant of acceptedInvites) {
      const advance = await advanceParticipantToNextStep(workspaceId, participant.campaign_id, participant.id, participant.current_step_id, client);
      if (advance.activity) pendingActivities.push(advance.activity);
      pendingActivities.push(await recordSystemActivity(workspaceId, { eventType: "campaign.invite_accepted", entityType: "campaign", entityId: participant.campaign_id, metadata: { campaignId: participant.campaign_id, participantId: participant.id } }, client));
    }
    const activity = await recordSystemActivity(workspaceId, {
      eventType: isOutbound ? "message.sent" : "message.received",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { conversationId, connectionId },
    }, client);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    for (const pending of pendingActivities) await dispatchCommittedActivity(pending);
    // Ingestion's own job stops here — it updated domain state
    // (invite_accepted_at, current_step_id) and nothing more. Whether and
    // when the message actually goes out is entirely the Campaign Engine's
    // decision (docs spec §1/§4), triggered — not performed — from here.
    // Dynamic import: unipile-adapter.ts -> engine.ts -> linkedin-executor.ts
    // -> prospecting.ts -> unipile-adapter.ts (findOrCreateContact) would
    // otherwise be a circular static import; same fix activities.ts already
    // uses for automations.ts.
    const campaignsToRun = new Set(acceptedInvites.map((p) => p.campaign_id));
    if (campaignsToRun.size > 0) {
      const { runDueCampaignActions } = await import("../campaign-execution/engine");
      const systemContext: WorkspaceContext = { workspaceId, userId: "", authUserId: "webhook", role: "owner" };
      for (const campaignId of campaignsToRun) {
        try {
          await runDueCampaignActions(systemContext, campaignId);
        } catch (error) {
          console.error(`[unipile-adapter] campaign engine trigger failed for campaign ${campaignId}`, error);
        }
      }
    }
    for (const participant of stoppedParticipants) {
      const stopActivity = await recordSystemActivity(workspaceId, { eventType: "campaign.participant_stopped", entityType: "campaign", entityId: participant.campaign_id, metadata: { campaignId: participant.campaign_id, participantId: participant.id, reason: "replied" } });
      await dispatchCommittedActivity(stopActivity);
    }
    return { status: "ingested" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// --- LinkedIn prospecting: invitation acceptance detection ---
// Per Unipile's docs, an invitation sent with a personalized note opens a
// chat whose first message IS that note once accepted — so acceptance
// arrives through this same message-ingestion path, not a separate
// 'new_relation' webhook subscription (which can lag up to 8 hours since
// LinkedIn has no real-time support for it). See app/lib/prospecting.ts for
// the sending side of this flow.
async function markProspectingInvitesAccepted(client: import("pg").PoolClient, workspaceId: string, contactId: string): Promise<Array<{ id: string; campaign_id: string; current_step_id: string }>> {
  const result = await client.query<{ id: string; campaign_id: string; current_step_id: string }>(
    `update campaign_participants set invite_accepted_at=now(),updated_at=now()
     where contact_id=$1 and invite_sent_at is not null and invite_accepted_at is null
       and campaign_id in (select id from campaigns where workspace_id=$2)
     returning id,campaign_id,current_step_id`,
    [contactId, workspaceId],
  );
  return result.rows;
}

// docs/product/ARCHITECTURE.md §6 point 5 / DECISIONS.md "LinkedIn campaign
// behavior": a real reply stops only that participant's future automated
// steps, never the whole campaign. `excludeParticipantIds` keeps the
// invitation-acceptance message (which IS this contact's first inbound
// message, handled above by markProspectingInvitesAccepted) from
// immediately self-stopping before its own follow-up message can send.
// Matches both 'active' (a future wait/follow_up step exists and must never
// fire) and 'completed' (nothing left to stop, but the participant should
// still reflect that the prospect actually engaged). Idempotent via
// `replied_at is null` — a second reply is a no-op here, not a second stop.
async function stopParticipantsOnReply(client: import("pg").PoolClient, workspaceId: string, contactId: string, excludeParticipantIds: string[]): Promise<Array<{ id: string; campaign_id: string }>> {
  const result = await client.query<{ id: string; campaign_id: string }>(
    `update campaign_participants set status='replied',replied_at=now(),updated_at=now()
     where contact_id=$1 and status in ('active','completed') and invite_accepted_at is not null and replied_at is null
       and campaign_id in (select id from campaigns where workspace_id=$2)
       and not (id = any($3::uuid[]))
     returning id,campaign_id`,
    [contactId, workspaceId, excludeParticipantIds],
  );
  return result.rows;
}

export type BackfillSummary = { chatsProcessed: number; messagesInserted: number; chatsFailed: number };

type BackfillChatResult = { skippedGroup: boolean; messagesInserted: number };

// Never log a full chat id (WhatsApp/LinkedIn chat ids can be built from a
// provider-side phone number on some accounts) — a short, non-reversible
// prefix is enough to correlate log lines for one chat during a backfill run
// without being a stable, searchable identifier.
function truncateChatId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…(${id.length})` : id;
}

// unipileGet already embeds the HTTP status in its thrown Error's message
// (see unipile.ts) — same pattern the LinkedIn invite executor already
// checks for. Reused here purely for performance-log observability, never
// to change retry/backoff behavior (out of scope for this phase).
const RATE_LIMITED_PATTERN = /\(429\)/;

type MessageUpsertRow = {
  workspaceId: string; conversationId: string; direction: "inbound" | "outbound";
  senderContactId: string | null; body: string; status: "sent" | "received";
  providerMessageId: string; timestamp: string; metadataJson: string;
};

// Builds ONE multi-row INSERT...ON CONFLICT DO UPDATE for an entire page of
// messages (up to 100) instead of one round trip per message. Postgres
// applies the DO UPDATE SET clause per conflicting row against that row's
// own `excluded` values, so the status-rank guard and the
// imported-preserving metadata merge are exactly as precise per-row as the
// old one-row-at-a-time version — nothing about those invariants changes,
// only how many round trips it costs to apply them.
function buildMessageUpsertQuery(rows: MessageUpsertRow[]): { sql: string; params: unknown[] } {
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((row, index) => {
    const base = index * 9;
    const [p1, p2, p3, p4, p5, p6, p7, p8, p9] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => base + n);
    values.push(`($${p1},$${p2},$${p3},$${p4},$${p5},$${p6},$${p7},case when $${p3}::varchar='outbound' then $${p8}::timestamptz else null end,case when $${p3}::varchar='inbound' then $${p8}::timestamptz else null end,$${p9}::jsonb)`);
    params.push(row.workspaceId, row.conversationId, row.direction, row.senderContactId, row.body, row.status, row.providerMessageId, row.timestamp, row.metadataJson);
  });
  const sql = `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at,metadata)
     values ${values.join(",")}
     on conflict(conversation_id,provider_message_id) where provider_message_id is not null do update set
       direction=excluded.direction,
       sender_contact_id=excluded.sender_contact_id,
       body=excluded.body,
       status=case when ${statusRankSql("messages.status")} > ${statusRankSql("excluded.status")} then messages.status else excluded.status end,
       metadata=messages.metadata || (excluded.metadata - 'imported')
     returning id`;
  return { sql, params };
}

// Transaction #1 of 2 for one chat — short-lived, resolves/creates Contact +
// Conversation only, then commits immediately. Kept separate from message
// persistence so this never sits open across a Unipile network call.
async function resolveContactAndConversation(workspaceId: string, connectionId: string, channelType: string, chatId: string, counterparty: Awaited<ReturnType<typeof listChatAttendees>>[number]): Promise<{ contactId: string; conversationId: string }> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const contactId = await findOrCreateContact(client, workspaceId, channelType, counterparty.provider_id, counterparty.profile_url, counterparty.name ?? "", counterparty.picture_url, counterparty.specifics?.occupation);
    const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, channelType, chatId, contactId);
    await client.query("commit");
    return { contactId, conversationId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// Transaction #2..N — one short transaction PER PAGE, opened only around the
// batch upsert itself (never around the Unipile fetch that produced the
// page). A failure on page K no longer rolls back pages 1..K-1 — they're
// already committed — so a retried chat has strictly less redundant work to
// redo than before, not more.
async function persistMessagePage(workspaceId: string, conversationId: string, contactId: string, messages: Awaited<ReturnType<typeof listChatMessages>>["items"]): Promise<number> {
  const rows: MessageUpsertRow[] = messages.filter((message) => !message.deleted).map((message) => {
    const attachments = normalizeAttachments(message.attachments);
    return {
      workspaceId, conversationId,
      direction: message.is_sender ? "outbound" : "inbound",
      senderContactId: message.is_sender ? null : contactId,
      body: message.text ?? "",
      status: message.is_sender ? "sent" : "received",
      providerMessageId: message.id,
      timestamp: message.timestamp,
      metadataJson: JSON.stringify({ ...(attachments.length ? { attachments } : {}), imported: true }),
    };
  });
  if (!rows.length) return 0;

  const { sql, params } = buildMessageUpsertQuery(rows);
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string }>(sql, params);
    await client.query("commit");
    return result.rows.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// V1 group-chat policy: WhatsApp groups are ignored entirely, never
// attributed to whichever participant happens to come first. A chat counts
// as a group when it has MORE THAN ONE non-self attendee — exactly one
// non-self attendee is a real 1:1 conversation; zero is a chat with no
// external participant at all (self-chat, deleted account) and is left
// exactly as before: nothing to attach messages to, silently 0 messages.
//
// Performance structure (this phase): attendees fetch, then per page —
// Unipile fetch OUTSIDE any transaction, then a short transaction just for
// that page's batch upsert. No transaction is ever held open across a
// network call. Chats are still processed strictly sequentially (no
// concurrency between chats in this phase). Emits one [unipile][perf] log
// line per page and one summary line per chat — never message content, full
// phone numbers, names, tokens, or raw payloads.
async function backfillChat(workspaceId: string, connectionId: string, config: NonNullable<ReturnType<typeof getUnipileConfig>>, chat: Awaited<ReturnType<typeof listChats>>["items"][number], channelType: string): Promise<BackfillChatResult> {
  const chatStartedAt = Date.now();
  const chatLogId = truncateChatId(chat.id);

  const attendeesStartedAt = Date.now();
  const attendees = await listChatAttendees(config, chat.id);
  const attendeesFetchMs = Date.now() - attendeesStartedAt;

  const nonSelf = attendees.filter((attendee) => !attendee.is_self);
  if (nonSelf.length > 1) return { skippedGroup: true, messagesInserted: 0 };
  const counterparty = nonSelf[0];
  if (!counterparty) return { skippedGroup: false, messagesInserted: 0 };

  let messagesFetchMs = 0;
  let dbPersistenceMs = 0;
  let messagesInserted = 0;
  let pageCount = 0;

  try {
    const resolveStartedAt = Date.now();
    const { contactId, conversationId } = await resolveContactAndConversation(workspaceId, connectionId, channelType, chat.id, counterparty);
    dbPersistenceMs += Date.now() - resolveStartedAt;

    let messagesCursor: string | undefined;
    do {
      const pageFetchStartedAt = Date.now();
      const messagesPage = await listChatMessages(config, chat.id, messagesCursor);
      const fetchMs = Date.now() - pageFetchStartedAt;
      messagesFetchMs += fetchMs;
      pageCount += 1;

      const dbStartedAt = Date.now();
      const insertedInPage = await persistMessagePage(workspaceId, conversationId, contactId, messagesPage.items);
      const dbMs = Date.now() - dbStartedAt;
      dbPersistenceMs += dbMs;
      messagesInserted += insertedInPage;

      console.log(`[unipile][perf] chat=${chatLogId} page=${pageCount} pageSize=${messagesPage.items.length} fetchMs=${fetchMs} dbMs=${dbMs}`);

      messagesCursor = messagesPage.cursor ?? undefined;
      // A single very large chat must not let the heartbeat go stale while
      // it's genuinely still being paged through — see touchSyncHeartbeat.
      await touchSyncHeartbeat(connectionId);
    } while (messagesCursor);

    const finalUpdateStartedAt = Date.now();
    await database.query(`update conversations set last_message_at=greatest(coalesce(last_message_at,'epoch'::timestamptz),$2::timestamptz),updated_at=now() where id=$1`, [conversationId, chat.timestamp ?? new Date().toISOString()]);
    dbPersistenceMs += Date.now() - finalUpdateStartedAt;

    const totalMs = Date.now() - chatStartedAt;
    console.log(`[unipile][perf] chat=${chatLogId} attendeesFetchMs=${attendeesFetchMs} messagesFetchMs=${messagesFetchMs} dbPersistenceMs=${dbPersistenceMs} messageCount=${messagesInserted} pageCount=${pageCount} totalMs=${totalMs}`);

    return { skippedGroup: false, messagesInserted };
  } catch (error) {
    const rateLimited = error instanceof Error && RATE_LIMITED_PATTERN.test(error.message);
    const totalMs = Date.now() - chatStartedAt;
    console.error(`[unipile][perf] chat=${chatLogId} failed attendeesFetchMs=${attendeesFetchMs} messagesFetchMs=${messagesFetchMs} dbPersistenceMs=${dbPersistenceMs} messageCount=${messagesInserted} pageCount=${pageCount} totalMs=${totalMs}${rateLimited ? " rateLimited=true" : ""}`);
    throw error;
  }
}

// unipileGet's own thrown Error embeds the request path in its message
// (`Unipile GET ${path} failed (${status}).`, see unipile.ts) — and a chat's
// path segment can be a provider-derived identifier that, for some WhatsApp
// accounts, is built from a phone number (see truncateChatId's comment).
// That path is stripped before this ever reaches connections.metadata.sync,
// which the Connections UI reads directly — the HTTP status itself is kept,
// since it's the one useful diagnostic detail in that message. Every other
// error shape (Postgres/SQL errors, AbortSignal timeouts, generic JS
// errors) carries no request-specific user data in its .message by
// construction, so it's preserved as-is (truncated only for length).
const UNIPILE_HTTP_ERROR_PATTERN = /^Unipile GET .+ failed \((\d+)\)\.$/;

function sanitizeSyncError(error: unknown): string {
  if (!(error instanceof Error)) return "Erreur de synchronisation.";
  const unipileMatch = error.message.match(UNIPILE_HTTP_ERROR_PATTERN);
  if (unipileMatch) return `Appel à Unipile en échec (HTTP ${unipileMatch[1]}).`;
  return error.message.slice(0, 500);
}

// Historical import for an already-connected LinkedIn or WhatsApp account.
// Only ever invoked by runDueConnectionSyncs (the durable job runner) —
// never called directly from an HTTP route, since a full history can take a
// while to page through. Idempotent: safe to re-run in full (e.g. after a
// crash) since every message insert is keyed by provider_message_id, same as
// the live webhook path. Writes its own progress into
// connections.metadata.sync as it goes (heartbeat + counters after every
// chat processed/skipped/failed) so a caller never needs to guess progress.
// Deliberately never calls recordSystemActivity/dispatchCommittedActivity —
// a historical import must never trigger an automation, a campaign, a stop,
// or an opportunity. See ingestMessage for the real-time path that does.
export async function backfillConnectionHistory(connectionId: string): Promise<ConnectionSyncState> {
  const state: ConnectionSyncState = {
    status: "running", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), completedAt: null,
    chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: null,
  };
  try {
    const config = getUnipileConfig();
    if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");

    const connectionResult = await database.query<{ workspace_id: string; channel_type: string; external_account_id: string }>(
      `select workspace_id,channel_type,external_account_id from connections where id=$1 and status='connected'`,
      [connectionId],
    );
    const connection = connectionResult.rows[0];
    if (!connection) throw new Error("Connexion introuvable ou non connectée.");
    if (connection.channel_type !== "linkedin" && connection.channel_type !== "whatsapp") {
      throw new Error(`Synchronisation de l'historique non disponible pour ${connection.channel_type} pour le moment.`);
    }
    const { workspace_id: workspaceId, external_account_id: accountId, channel_type: channelType } = connection;

    let chatsCursor: string | undefined;
    do {
      const chatsPage = await listChats(config, accountId, chatsCursor);
      for (const chat of chatsPage.items) {
        try {
          const result = await backfillChat(workspaceId, connectionId, config, chat, channelType);
          if (result.skippedGroup) state.chatsSkippedGroups += 1;
          else {
            state.chatsProcessed += 1;
            state.messagesImported += result.messagesInserted;
          }
        } catch (error) {
          // A single slow/failed chat (timeout, transient Unipile error) must
          // not abort hours of otherwise-successful pagination — log and move
          // on; re-running the sync will retry whatever didn't complete.
          state.chatsFailed += 1;
          console.error(`[unipile] backfill failed for chat ${chat.id}`, error);
        }
        state.heartbeatAt = new Date().toISOString();
        await writeSyncState(connectionId, state);
      }
      chatsCursor = chatsPage.cursor ?? undefined;
    } while (chatsCursor);

    state.status = "completed";
    state.completedAt = new Date().toISOString();
    await writeSyncState(connectionId, state);
    return state;
  } catch (error) {
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.error = sanitizeSyncError(error);
    await writeSyncState(connectionId, state);
    throw error;
  }
}

// The durable job runner — the counterpart to lib/acquisition/scheduler.ts
// and campaign-execution/engine.ts's runEngineSweep, meant to be hit
// periodically by the same external cron (see api/connections/sync/run).
// Claim is a single atomic statement: SELECT ... FOR UPDATE SKIP LOCKED
// inside a CTE, immediately followed by the UPDATE that flips claimed rows
// to 'running' with fresh counters, all in one round trip — there is never a
// window where two concurrent runner invocations can both see the same
// connection as claimable, matching the exact pattern already proven by
// runAcquisitionScheduler.
export async function runDueConnectionSyncs(limit = 3): Promise<{ claimed: number; completed: number; failed: number }> {
  const claimState = JSON.stringify({
    status: "running", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), completedAt: null,
    chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: null,
  });
  const claimed = await database.query<{ id: string }>(
    `with due as (
       select id from connections
       where provider=$2 and status='connected'
         and (
           metadata->'sync'->>'status' = 'pending'
           or (
             metadata->'sync'->>'status' = 'running'
             and metadata->'sync'->>'heartbeatAt' is not null
             and (metadata->'sync'->>'heartbeatAt')::timestamptz < now() - interval '${SYNC_STALE_AFTER}'
           )
         )
       order by coalesce((metadata->'sync'->>'startedAt')::timestamptz, 'epoch'::timestamptz)
       for update skip locked
       limit $1
     )
     update connections c set metadata=jsonb_set(coalesce(c.metadata,'{}'::jsonb),'{sync}',$3::jsonb), updated_at=now()
     from due where c.id=due.id
     returning c.id`,
    [Math.min(Math.max(limit, 1), 20), PROVIDER, claimState],
  );

  let completed = 0, failed = 0;
  for (const row of claimed.rows) {
    try {
      await backfillConnectionHistory(row.id);
      completed += 1;
    } catch (error) {
      // backfillConnectionHistory already persisted its own 'failed' state —
      // this catch only keeps one connection's failure from stopping the
      // rest of this batch, mirroring runAcquisitionScheduler's per-item
      // try/catch.
      failed += 1;
      console.error(`[unipile] connection sync failed for connection ${row.id}`, error);
    }
  }
  return { claimed: claimed.rows.length, completed, failed };
}

const SYNC_FRESH_MS = 10 * 60 * 1000; // matches SYNC_STALE_AFTER

// Fast, session-authenticated entry point for both the auto-triggered first
// sync's UI polling and a manual resync click — POST
// /api/connections/[channel]/sync. Never runs the backfill itself: it only
// decides whether to (re)enqueue and returns immediately, leaving the actual
// work to the next runDueConnectionSyncs pass. Idempotent: a pending or
// still-fresh running sync is returned as-is, never duplicated.
export async function requestConnectionSync(workspaceId: string, channelType: "linkedin" | "whatsapp"): Promise<ConnectionSyncState> {
  const result = await database.query<{ id: string; metadata: { sync?: ConnectionSyncState } }>(
    `select id,metadata from connections where workspace_id=$1 and provider=$2 and channel_type=$3 and status='connected'`,
    [workspaceId, PROVIDER, channelType],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Ce canal n'est pas connecté.");

  const sync = row.metadata?.sync;
  const isFreshRunning = sync?.status === "running" && Boolean(sync.heartbeatAt) && Date.now() - new Date(sync.heartbeatAt!).getTime() < SYNC_FRESH_MS;
  if (sync?.status === "pending" || isFreshRunning) return sync;

  await writeSyncState(row.id, INITIAL_SYNC_STATE);
  return INITIAL_SYNC_STATE;
}

export type SendMessageResult = { id: string; body: string; direction: "outbound"; status: "sent"; createdAt: string };

// The one write path in this module with a real, irreversible external
// effect: a real LinkedIn message to a real person. Only usable on a
// conversation whose connection is an actually-connected Unipile channel —
// api/inbox/conversations/[id]/messages falls back to a local draft
// (createDraft in lib/inbox.ts) for everything else, same as before this
// existed.
export async function sendMessage(workspaceId: string, conversationId: string, text: string): Promise<SendMessageResult> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");

  const result = await database.query<{ external_thread_id: string | null; external_account_id: string; status: string }>(
    `select v.external_thread_id,c.external_account_id,c.status
     from conversations v join connections c on c.id=v.connection_id
     where v.workspace_id=$1 and v.id=$2 and c.provider=$3`,
    [workspaceId, conversationId, PROVIDER],
  );
  const row = result.rows[0];
  if (!row?.external_thread_id) throw new Error("Ce canal n'est pas encore relié à un fournisseur réel.");
  if (row.status !== "connected") throw new Error("Ce canal n'est pas connecté.");

  const messageId = await sendChatMessage(config, row.external_thread_id, text);

  // ON CONFLICT DO UPDATE (a no-op update, not DO NOTHING) so this always
  // returns a row even in the rare race where the webhook for this exact
  // send already landed first — the message truly did go out either way.
  const inserted = await database.query<{ id: string; created_at: string }>(
    `insert into messages(workspace_id,conversation_id,direction,body,status,provider_message_id,sent_at)
     values($1,$2,'outbound',$3,'sent',$4,now())
     on conflict(conversation_id,provider_message_id) where provider_message_id is not null do update set status=excluded.status
     returning id,created_at`,
    [workspaceId, conversationId, text, messageId],
  );
  const savedRow = inserted.rows[0]!;

  await database.query(`update conversations set last_message_at=now(),updated_at=now() where id=$1`, [conversationId]);
  const activity = await recordSystemActivity(workspaceId, {
    eventType: "message.sent",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { conversationId },
  });
  await dispatchCommittedActivity(activity);

  return { id: savedRow.id, body: text, direction: "outbound", status: "sent", createdAt: savedRow.created_at };
}

const EDIT_WINDOW_MS = 60 * 60 * 1000;

// LinkedIn Classic accepts an edit up to 60 minutes after sending (per
// Unipile's docs — WhatsApp's own window is shorter). Checked here too, not
// just left to whatever error Unipile returns, so the UI can say something
// clearer than a raw provider rejection.
export async function editMessage(workspaceId: string, messageId: string, text: string): Promise<void> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");

  const result = await database.query<{ provider_message_id: string | null; sent_at: string | null; direction: string }>(
    `select m.provider_message_id,m.sent_at,m.direction
     from messages m join conversations v on v.id=m.conversation_id join connections c on c.id=v.connection_id
     where m.workspace_id=$1 and m.id=$2 and c.provider=$3`,
    [workspaceId, messageId, PROVIDER],
  );
  const row = result.rows[0];
  if (!row?.provider_message_id) throw new Error("Ce message n'est pas modifiable.");
  if (row.direction !== "outbound") throw new Error("Seuls vos propres messages peuvent être modifiés.");
  if (!row.sent_at || Date.now() - new Date(row.sent_at).getTime() > EDIT_WINDOW_MS) {
    throw new Error("Ce message ne peut plus être modifié — LinkedIn n'autorise la modification que dans l'heure suivant l'envoi.");
  }

  await editChatMessage(config, row.provider_message_id, text);
  await database.query(`update messages set body=$1,metadata=metadata||'{"edited":true}'::jsonb where id=$2`, [text, messageId]);
}
