import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import { normalizeLinkedIn } from "../../app/contacts/contact-utils";
import {
  getUnipileConfig,
  listChatAttendees,
  listChatMessages,
  listChats,
  sendChatMessage,
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
async function findOrCreateContact(client: import("pg").PoolClient, workspaceId: string, providerId: string, profileUrl: string | undefined, displayName: string, avatarUrl?: string) {
  const identifier = profileUrl || providerId;
  const identifierNormalized = profileUrl ? normalizeLinkedIn(profileUrl) : providerId;

  const existing = await client.query<{ contact_id: string }>(
    `select contact_id from contact_identities where workspace_id=$1 and channel_type='linkedin' and identifier_normalized=$2`,
    [workspaceId, identifierNormalized],
  );
  if (existing.rows[0]) {
    // Contacts already imported before an avatar was ever captured (e.g. by
    // the message webhook, which carries no picture field) get one attached
    // the next time a resync sees it, instead of staying blank forever.
    if (avatarUrl) {
      await client.query(
        `update contact_identities set metadata=metadata||jsonb_build_object('avatarUrl',$3::text) where workspace_id=$1 and channel_type='linkedin' and identifier_normalized=$2`,
        [workspaceId, identifierNormalized, avatarUrl],
      );
    }
    return existing.rows[0].contact_id;
  }

  const { firstName, lastName } = splitDisplayName(displayName || "Contact LinkedIn");
  const contact = await client.query<{ id: string }>(
    `insert into contacts(workspace_id,first_name,last_name,display_name,status) values($1,$2,$3,$4,'new') returning id`,
    [workspaceId, firstName, lastName, displayName || "Contact sans nom"],
  );
  const contactId = contact.rows[0]!.id;
  await client.query(
    `insert into contact_identities(workspace_id,contact_id,channel_type,provider,identifier,identifier_normalized,profile_url,metadata) values($1,$2,'linkedin',$3,$4,$5,$6,$7)
     on conflict(workspace_id,channel_type,identifier_normalized) do nothing`,
    [workspaceId, contactId, PROVIDER, identifier, identifierNormalized, profileUrl ?? null, JSON.stringify({ unipileProviderId: providerId, ...(avatarUrl ? { avatarUrl } : {}) })],
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

export type BackfillSummary = { chatsProcessed: number; messagesInserted: number; chatsFailed: number };

async function backfillChat(workspaceId: string, connectionId: string, config: NonNullable<ReturnType<typeof getUnipileConfig>>, chat: Awaited<ReturnType<typeof listChats>>["items"][number]): Promise<number> {
  const attendees = await listChatAttendees(config, chat.id);
  const counterparty = attendees.find((attendee) => !attendee.is_self);
  if (!counterparty) return 0; // group chats / chats with no external attendee aren't handled yet

  let messagesInserted = 0;
  const client = await database.connect();
  try {
    await client.query("begin");
    const contactId = await findOrCreateContact(client, workspaceId, counterparty.provider_id, counterparty.profile_url, counterparty.name ?? "", counterparty.picture_url);
    const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, "linkedin", chat.id, contactId);

    let messagesCursor: string | undefined;
    do {
      const messagesPage = await listChatMessages(config, chat.id, messagesCursor);
      for (const message of messagesPage.items) {
        if (message.deleted) continue;
        const direction = message.is_sender ? "outbound" : "inbound";
        const status = message.is_sender ? "sent" : "received";
        // Upsert, not insert-or-skip: this is a resync against Unipile's
        // authoritative record, so a message a stale ingestion path already
        // stored with the wrong direction/contact (e.g. from a production
        // deploy that predates a bugfix) gets corrected here instead of
        // being silently left wrong forever.
        const upserted = await client.query<{ id: string }>(
          `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at)
           values($1,$2,$3,$4,$5,$6,$7,case when $3::varchar='outbound' then $8::timestamptz else null end,case when $3::varchar='inbound' then $8::timestamptz else null end)
           on conflict(conversation_id,provider_message_id) where provider_message_id is not null do update set
             direction=excluded.direction,sender_contact_id=excluded.sender_contact_id,body=excluded.body,status=excluded.status
           returning id`,
          [workspaceId, conversationId, direction, message.is_sender ? null : contactId, message.text ?? "", status, message.id, message.timestamp],
        );
        if (upserted.rows[0]) messagesInserted += 1;
      }
      messagesCursor = messagesPage.cursor ?? undefined;
    } while (messagesCursor);

    await client.query(`update conversations set last_message_at=greatest(coalesce(last_message_at,'epoch'::timestamptz),$2::timestamptz),updated_at=now() where id=$1`, [conversationId, chat.timestamp ?? new Date().toISOString()]);
    await client.query("commit");
    return messagesInserted;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// One-time historical import, run explicitly after a connection succeeds
// (see api/connections/[channel]/sync) rather than inline in the webhook
// handler — Unipile expects a fast webhook response, and an account can have
// years of LinkedIn history to page through. Idempotent: safe to re-run
// (e.g. after a partial failure) since every message insert is keyed by
// provider_message_id, same as the live webhook path.
export async function backfillConnectionHistory(connectionId: string): Promise<BackfillSummary> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");

  const connectionResult = await database.query<{ workspace_id: string; channel_type: string; external_account_id: string }>(
    `select workspace_id,channel_type,external_account_id from connections where id=$1 and status='connected'`,
    [connectionId],
  );
  const connection = connectionResult.rows[0];
  if (!connection) throw new Error("Connexion introuvable ou non connectée.");
  if (connection.channel_type !== "linkedin") throw new Error(`Synchronisation de l'historique non disponible pour ${connection.channel_type} pour le moment.`);
  const { workspace_id: workspaceId, external_account_id: accountId } = connection;

  const summary: BackfillSummary = { chatsProcessed: 0, messagesInserted: 0, chatsFailed: 0 };
  let chatsCursor: string | undefined;
  do {
    const chatsPage = await listChats(config, accountId, chatsCursor);
    for (const chat of chatsPage.items) {
      try {
        summary.messagesInserted += await backfillChat(workspaceId, connectionId, config, chat);
        summary.chatsProcessed += 1;
      } catch (error) {
        // A single slow/failed chat (timeout, transient Unipile error) must
        // not abort hours of otherwise-successful pagination — log and move
        // on; re-running the sync will retry whatever didn't complete.
        summary.chatsFailed += 1;
        console.error(`[unipile] backfill failed for chat ${chat.id}`, error);
      }
    }
    chatsCursor = chatsPage.cursor ?? undefined;
  } while (chatsCursor);

  return summary;
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
