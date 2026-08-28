import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { normalizeLinkedIn } from "../../app/contacts/contact-utils";
import {
  toConnectionStatus,
  type UnipileAccountStatusPayload,
  type UnipileHostedAuthNotifyPayload,
  type UnipileNewMessagePayload,
} from "./unipile";

// Normalizes raw Unipile webhook payloads into Talvia's own entities
// (Connections, Contacts, Contact Identities, Conversations, Messages,
// Activities) per the provider adapter pattern in ARCHITECTURE.md §3.
// Nothing outside this file should know Unipile's payload shapes.

const PROVIDER = "unipile";

function splitDisplayName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

// The hosted auth flow's one-time confirmation: this is where we first learn
// which account_id Unipile assigned, and — via the `name` we set when
// requesting the link (`${workspaceId}::${channel}`) — which workspace and
// channel it belongs to.
export async function ingestHostedAuthNotification(payload: UnipileHostedAuthNotifyPayload) {
  const [workspaceId, channel] = payload.name.split("::");
  if (!workspaceId || (channel !== "linkedin" && channel !== "whatsapp" && channel !== "gmail")) return;
  const status = toConnectionStatus(payload.status);
  await database.query(
    `insert into connections(workspace_id,provider,channel_type,external_account_id,display_name,status,connected_at,last_synced_at)
     values($1,$2,$3,$4,$5,$6,case when $6::varchar='connected' then now() else null end,case when $6::varchar='connected' then now() else null end)
     on conflict(workspace_id,provider,external_account_id) do update set
       status=excluded.status,
       connected_at=case when excluded.status='connected' then now() else connections.connected_at end,
       last_synced_at=case when excluded.status='connected' then now() else connections.last_synced_at end`,
    [workspaceId, PROVIDER, channel, payload.account_id, channel === "gmail" ? "Gmail" : channel === "linkedin" ? "LinkedIn" : "WhatsApp", status],
  );
}

// Ongoing lifecycle events for an already-connected account (no workspace
// hint in the payload — must already have a connections row for account_id).
export async function ingestAccountStatus(payload: UnipileAccountStatusPayload["AccountStatus"]) {
  await database.query(
    `update connections set status=$1,
       connected_at=case when $1::varchar='connected' then now() else connected_at end,
       last_synced_at=case when $1::varchar='connected' then now() else last_synced_at end,
       updated_at=now()
     where provider=$2 and external_account_id=$3`,
    [toConnectionStatus(payload.message), PROVIDER, payload.account_id],
  );
}

// Dedup key matches the one contacts.ts already uses for manually-entered
// and CSV-imported contacts (workspace_id, channel_type, identifier_normalized)
// — a LinkedIn profile discovered via Unipile resolves to the same Contact as
// one a user already added by hand, instead of creating a duplicate.
async function findOrCreateContact(client: import("pg").PoolClient, workspaceId: string, providerId: string, profileUrl: string | undefined, displayName: string) {
  const identifier = profileUrl || providerId;
  const identifierNormalized = profileUrl ? normalizeLinkedIn(profileUrl) : providerId;

  const existing = await client.query<{ contact_id: string }>(
    `select contact_id from contact_identities where workspace_id=$1 and channel_type='linkedin' and identifier_normalized=$2`,
    [workspaceId, identifierNormalized],
  );
  if (existing.rows[0]) return existing.rows[0].contact_id;

  const { firstName, lastName } = splitDisplayName(displayName || "Contact LinkedIn");
  const contact = await client.query<{ id: string }>(
    `insert into contacts(workspace_id,first_name,last_name,display_name,status) values($1,$2,$3,$4,'new') returning id`,
    [workspaceId, firstName, lastName, displayName || "Contact sans nom"],
  );
  const contactId = contact.rows[0]!.id;
  await client.query(
    `insert into contact_identities(workspace_id,contact_id,channel_type,provider,identifier,identifier_normalized,profile_url,metadata) values($1,$2,'linkedin',$3,$4,$5,$6,$7)
     on conflict(workspace_id,channel_type,identifier_normalized) do nothing`,
    [workspaceId, contactId, PROVIDER, identifier, identifierNormalized, profileUrl ?? null, JSON.stringify({ unipileProviderId: providerId })],
  );
  return contactId;
}

async function findOrCreateConversation(client: import("pg").PoolClient, workspaceId: string, connectionId: string, channelType: string, externalThreadId: string, contactId: string) {
  const existing = await client.query<{ id: string }>(
    `select id from conversations where connection_id=$1 and external_thread_id=$2`,
    [connectionId, externalThreadId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

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

// Idempotent by (conversation_id, provider_message_id) — a redelivered
// webhook for a message we already stored is a safe no-op, matching the
// same unique-constraint pattern createTestInbound() uses in lib/inbox.ts.
export async function ingestMessage(payload: UnipileNewMessagePayload): Promise<IngestResult> {
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

    const contactId = await findOrCreateContact(client, workspaceId, counterparty.attendee_provider_id, counterparty.attendee_profile_url, counterparty.attendee_name ?? "");
    const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, channelType, payload.chat_id, contactId);

    const direction = isOutbound ? "outbound" : "inbound";
    const status = isOutbound ? "sent" : "received";
    const inserted = await client.query<{ id: string }>(
      `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at)
       values($1,$2,$3,$4,$5,$6,$7,case when $3::varchar='outbound' then now() else null end,case when $3::varchar='inbound' then now() else null end)
       on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing
       returning id`,
      [workspaceId, conversationId, direction, isOutbound ? null : contactId, payload.message ?? "", status, payload.message_id],
    );
    if (!inserted.rows[0]) {
      await client.query("rollback");
      return { status: "duplicate" };
    }

    await client.query(`update conversations set last_message_at=now(),updated_at=now() where id=$1`, [conversationId]);
    const activity = await recordSystemActivity(workspaceId, {
      eventType: isOutbound ? "message.sent" : "message.received",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { conversationId, connectionId },
    }, client);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    return { status: "ingested" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
