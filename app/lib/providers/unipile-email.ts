import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import {
  findOrCreateContact,
  findOrCreateConversation,
  stopParticipantsOnReply,
  PROVIDER,
  type IngestResult,
} from "./unipile-adapter";
import { normalizeEmail } from "../../app/contacts/contact-utils";
import type { ReasonCode } from "../campaign-execution/reason-codes";
import { getEmailByMessageId, getUnipileConfig, sendEmail, type UnipileEmail, type UnipileEmailAttendee, type UnipileNewEmailPayload } from "./unipile";

// Email ingestion. Deliberately a separate module from unipile-adapter.ts's
// chat ingestion rather than a generalization of it: Unipile models mail as
// its own resource (own endpoints, own payload, no chat_id/attendees), so
// forcing the two through one code path would mean a pile of channel
// conditionals inside an already-1000-line file. What is NOT duplicated is
// anything carrying a business invariant — Contact resolution
// (findOrCreateContact), conversation grouping (findOrCreateConversation) and
// above all the reply-stop rule (stopParticipantsOnReply) are imported from
// the adapter, so there is exactly one implementation of each.

// A provider HTML body must never reach the client as-is (no sanitizer here,
// and the Inbox renders message bodies as text through linkifyText). Unipile
// gives body_plain for exactly this reason; the strip below is only the
// fallback for a mail that somehow arrives without one. It is intentionally
// crude — Talvia stores a readable plain-text rendering, it is not building a
// MIME/HTML engine.
export function toPlainTextBody(email: { body_plain?: string; body?: string }): string {
  const plain = email.body_plain?.trim();
  if (plain) return plain;
  const html = email.body?.trim();
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attendeeAddress(attendee: UnipileEmailAttendee | null | undefined): string | null {
  const identifier = attendee?.identifier?.trim();
  return identifier ? identifier : null;
}

// Direction comes from the event name, which is authoritative — never from
// comparing addresses (an account can legitimately send to itself, and alias
// addresses would make an address comparison wrong).
function directionForEvent(event: UnipileNewEmailPayload["event"]): "inbound" | "outbound" | null {
  if (event === "mail_received") return "inbound";
  if (event === "mail_sent") return "outbound";
  return null; // mail_moved: a folder change, not a new business message
}

// The counterparty is whoever is NOT the connected account: the sender for a
// received mail, the first recipient for one we sent. cc/bcc are preserved as
// metadata but never define the Conversation's Contact — a Talvia
// conversation is with one commercial counterpart, and promoting a cc'd
// address to "the contact" would silently rewrite whose thread this is.
function resolveCounterparty(payload: UnipileNewEmailPayload, direction: "inbound" | "outbound"): UnipileEmailAttendee | null {
  if (direction === "inbound") return payload.from_attendee ?? null;
  return payload.to_attendees?.[0] ?? null;
}

export type EmailMessageMetadata = {
  subject?: string;
  emailMessageId?: string;
  emailProviderId?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  attachments?: Array<{ id: string; name?: string; mime?: string; size?: number }>;
  imported?: true;
  // "pending_first_touch" is the ONLY provisional value: a mail Talvia just
  // sent to an address that had no thread yet, keyed on the provider id the
  // send actually returned (never an invented thread id). It is replaced by
  // the real resolution the moment the mail_sent webhook lets us look the
  // canonical thread up — see reconcileOutboundSend below.
  threadResolution?: "provider_thread_id" | "fallback_message_id" | "pending_first_touch" | "reconciliation_conflict";
};

function buildMetadata(payload: UnipileNewEmailPayload, threadResolution: EmailMessageMetadata["threadResolution"]): EmailMessageMetadata {
  return {
    ...(payload.subject ? { subject: payload.subject } : {}),
    ...(payload.message_id ? { emailMessageId: payload.message_id } : {}),
    ...(payload.provider_id ? { emailProviderId: payload.provider_id } : {}),
    ...(attendeeAddress(payload.from_attendee) ? { from: attendeeAddress(payload.from_attendee)! } : {}),
    ...(payload.to_attendees?.length ? { to: payload.to_attendees.map((a) => a.identifier).filter(Boolean) } : {}),
    ...(payload.cc_attendees?.length ? { cc: payload.cc_attendees.map((a) => a.identifier).filter(Boolean) } : {}),
    ...(payload.attachments?.length
      ? { attachments: payload.attachments.map((a) => ({ id: a.id, ...(a.name ? { name: a.name } : {}), ...(a.mime ? { mime: a.mime } : {}), ...(a.size ? { size: a.size } : {}) })) }
      : {}),
    ...(threadResolution ? { threadResolution } : {}),
  };
}

// The webhook payload has no thread_id (unlike GET /api/v1/emails), so the
// canonical thread is looked up from the provider by the mail's own RFC
// message_id rather than invented. If that lookup finds nothing, the RFC
// message_id itself becomes the thread key — correct for a genuinely new
// single-message thread — and the choice is recorded in metadata so a mail
// filed that way stays diagnosable (and reconcilable) later. A provider
// TRANSPORT failure is deliberately not caught here: it propagates, the
// webhook returns 5xx, and Unipile redelivers — which is safe precisely
// because the message insert below is idempotent.
async function resolveThreadKey(payload: UnipileNewEmailPayload): Promise<{ threadKey: string; resolution: EmailMessageMetadata["threadResolution"] } | null> {
  const config = getUnipileConfig();
  if (config && payload.message_id) {
    const email = await getEmailByMessageId(config, payload.account_id, payload.message_id);
    if (email?.thread_id) return { threadKey: email.thread_id, resolution: "provider_thread_id" };
  }
  const fallback = payload.message_id ?? payload.provider_id ?? payload.email_id;
  return fallback ? { threadKey: fallback, resolution: "fallback_message_id" } : null;
}

// --- Outbound reconciliation ---
// EVERY mail Talvia sends is mirrored locally the moment the provider accepts
// it, keyed on the `provider_id` the send response returned — the only real
// identifier available at that instant. Minutes later the provider's own
// mail_sent webhook describes the SAME mail, carrying that provider_id, the
// canonical Unipile email_id, and enough to resolve the real thread. Without
// this function the two never meet: the ids differ, so the unique
// (conversation_id, provider_message_id) index cannot relate them, and one
// real email becomes two message rows and two `message.sent` activities.
//
// It applies to BOTH send paths, deliberately:
//   - a first touch, whose Conversation still has external_thread_id = NULL
//     and gets the canonical thread filled in here;
//   - a threaded reply, whose Conversation already has the right thread and
//     only needs its message re-keyed.
// Restricting it to first touches (as an earlier revision did) left the
// threaded path duplicating every campaign reply and every Inbox reply.
//
// Re-keying the message onto the canonical email_id is what makes every LATER
// arrival collapse onto it: a webhook redelivery and a historical re-import
// both carry that same email_id.
//
// Returns true when it handled this payload — the caller then stops, exactly
// as it does for any other already-known message.
async function reconcileOutboundSend(
  client: import("pg").PoolClient,
  workspaceId: string,
  connectionId: string,
  payload: UnipileNewEmailPayload,
  thread: { threadKey: string; resolution: EmailMessageMetadata["threadResolution"] },
): Promise<boolean> {
  if (!payload.provider_id) return false;
  const mirrored = await client.query<{ id: string; conversation_id: string; external_thread_id: string | null }>(
    `select m.id,m.conversation_id,v.external_thread_id
     from messages m join conversations v on v.id=m.conversation_id
     where m.workspace_id=$1 and v.connection_id=$2 and m.metadata->>'emailProviderId'=$3
     limit 1`,
    [workspaceId, connectionId, payload.provider_id],
  );
  const row = mirrored.rows[0];
  if (!row) return false;

  let resolution: EmailMessageMetadata["threadResolution"] = thread.resolution;
  let conversationId = row.conversation_id;

  if (row.external_thread_id !== thread.threadKey) {
    // Does another Conversation on this connection already own the canonical
    // thread? (A resync that paged this thread in before the webhook landed
    // is the realistic way this happens.)
    const owner = await client.query<{ id: string }>(
      `select id from conversations where connection_id=$1 and external_thread_id=$2`,
      [connectionId, thread.threadKey],
    );
    const ownerId = owner.rows[0]?.id;

    if (!ownerId) {
      // Nobody owns it: this Conversation becomes the real one. Covers the
      // normal first touch (NULL -> canonical thread).
      await client.query(`update conversations set external_thread_id=$2,updated_at=now() where id=$1`, [row.conversation_id, thread.threadKey]);
    } else if (ownerId !== row.conversation_id) {
      // Two Conversations now describe one thread. Converge on the one that
      // genuinely owns the canonical thread by MOVING this message into it —
      // never by merging thread keys, and never by leaving both alive.
      const ownerAlreadyHasIt = await client.query<{ id: string }>(
        `select id from messages where conversation_id=$1 and (provider_message_id=$2 or metadata->>'emailProviderId'=$3)`,
        [ownerId, payload.email_id, payload.provider_id],
      );
      if (ownerAlreadyHasIt.rows[0]) {
        // The owning Conversation already holds this exact mail. Ours is a
        // strict duplicate of a better-keyed row; say so rather than silently
        // leaving two copies of one email in the Inbox.
        resolution = "reconciliation_conflict";
        console.error(`[unipile-email] outbound reconciliation: duplicate mirror for conversation ${row.conversation_id}`);
      } else {
        await client.query(`update messages set conversation_id=$2 where id=$1`, [row.id, ownerId]);
        conversationId = ownerId;
        // Archive the emptied provisional Conversation instead of deleting
        // it — a modelled state, reversible, and it never had a thread of its
        // own to lose.
        await client.query(
          `update conversations set status='archived',updated_at=now()
           where id=$1 and external_thread_id is null and not exists (select 1 from messages m where m.conversation_id=$1)`,
          [row.conversation_id],
        );
      }
    }
  }

  // Only re-key onto the canonical id when it is genuinely free on the target
  // conversation — otherwise the webhook's own row already exists there and
  // the unique index would reject the update.
  const canonicalIdTaken = await client.query<{ id: string }>(
    `select id from messages where conversation_id=$1 and provider_message_id=$2 and id<>$3`,
    [conversationId, payload.email_id, row.id],
  );
  const patch: Record<string, unknown> = { threadResolution: resolution };
  if (payload.message_id) patch.emailMessageId = payload.message_id;
  await client.query(
    `update messages set provider_message_id=case when $4 then provider_message_id else $2 end, metadata=metadata||$3::jsonb where id=$1`,
    [row.id, payload.email_id, JSON.stringify(patch), Boolean(canonicalIdTaken.rows[0])],
  );
  if (payload.subject) {
    await client.query(`update conversations set subject=$2 where id=$1 and (subject is null or subject='')`, [conversationId, payload.subject]);
  }
  return true;
}

export async function ingestEmail(payload: UnipileNewEmailPayload): Promise<IngestResult> {
  const direction = directionForEvent(payload.event);
  if (!direction) return { status: "ignored" };

  const counterparty = resolveCounterparty(payload, direction);
  const address = attendeeAddress(counterparty);
  if (!address) {
    console.error(`[unipile-email] ingestEmail: no resolvable counterparty for email_id=${payload.email_id} event=${payload.event}`);
    return { status: "ignored" };
  }

  // Resolved BEFORE opening the transaction: this can perform a provider
  // fetch, and a network round trip must never be held inside an open
  // Postgres transaction (the same discipline the chat backfill follows).
  const thread = await resolveThreadKey(payload);
  if (!thread) return { status: "ignored" };

  const client = await database.connect();
  try {
    await client.query("begin");
    const connection = await client.query<{ id: string; workspace_id: string; channel_type: string }>(
      `select id,workspace_id,channel_type from connections where provider=$1 and external_account_id=$2`,
      [PROVIDER, payload.account_id],
    );
    const connectionRow = connection.rows[0];
    if (!connectionRow || connectionRow.channel_type !== "email") {
      await client.query("rollback");
      return { status: "unknown_account" };
    }
    const { id: connectionId, workspace_id: workspaceId } = connectionRow;

    // Before anything is created: is this the webhook for a mail Talvia
    // itself sent (first touch OR threaded reply)? If so it is already
    // stored, and the only work left is joining it to its real thread and
    // canonical id — never a second row, never a second activity.
    if (direction === "outbound" && await reconcileOutboundSend(client, workspaceId, connectionId, payload, thread)) {
      await client.query("commit");
      return { status: "duplicate" };
    }

    const contactId = await findOrCreateContact(client, workspaceId, "email", address, undefined, counterparty?.display_name ?? "");
    const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, "email", thread.threadKey, contactId);

    if (payload.subject) {
      // First subject seen wins — a "Re:" on a later message must not
      // rewrite the thread's original subject.
      await client.query(`update conversations set subject=$2 where id=$1 and (subject is null or subject='')`, [conversationId, payload.subject]);
    }

    const inserted = await client.query<{ id: string }>(
      `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at,metadata)
       values($1,$2,$3,$4,$5,$6,$7,case when $3::varchar='outbound' then $8::timestamptz else null end,case when $3::varchar='inbound' then $8::timestamptz else null end,$9)
       on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing
       returning id`,
      [
        workspaceId,
        conversationId,
        direction,
        direction === "inbound" ? contactId : null,
        toPlainTextBody(payload),
        direction === "inbound" ? "received" : "sent",
        payload.email_id,
        payload.date,
        JSON.stringify(buildMetadata(payload, thread.resolution)),
      ],
    );
    if (!inserted.rows[0]) {
      await client.query("rollback");
      return { status: "duplicate" };
    }

    await client.query(`update conversations set last_message_at=greatest(coalesce(last_message_at,$2::timestamptz),$2::timestamptz),updated_at=now() where id=$1`, [conversationId, payload.date]);

    // A real inbound reply stops that Contact's active EMAIL participants
    // only — stopParticipantsOnReply is channel-scoped, so this can never
    // stop a LinkedIn or WhatsApp sequence for the same person. No
    // invitation/acceptance concept exists on email, hence no exclusions.
    const stoppedParticipants = direction === "inbound"
      ? await stopParticipantsOnReply(client, workspaceId, contactId, "email", [])
      : [];

    const activity = await recordSystemActivity(workspaceId, {
      eventType: direction === "inbound" ? "message.received" : "message.sent",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { conversationId, connectionId },
    }, client);

    await client.query("commit");
    await dispatchCommittedActivity(activity);
    for (const participant of stoppedParticipants) {
      const stopActivity = await recordSystemActivity(workspaceId, {
        eventType: "campaign.participant_stopped",
        entityType: "campaign",
        entityId: participant.campaign_id,
        metadata: { campaignId: participant.campaign_id, participantId: participant.id, reason: "replied" },
      });
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

// --- Sending ---

export type SendEmailOutcome = { providerMessageId: string | null; subject: string | null };

// Resolves everything an email send needs from Talvia's own state — the
// recipient from the Contact's email identity (never from a client-supplied
// address), the subject from the thread, and the parent message id so the
// reply lands in the same provider thread instead of starting a new one.
// Throws rather than guessing when the recipient cannot be resolved: sending
// a real email to a wrong or invented address is not recoverable.
export async function sendEmailForConversation(
  workspaceId: string,
  conversationId: string,
  text: string,
  externalAccountId: string,
  idempotencyKey?: string,
): Promise<SendEmailOutcome> {
  const config = getUnipileConfig();
  if (!config) throw new Error("Unipile n'est pas configuré sur cet environnement.");

  const context = await database.query<{ subject: string | null; display_name: string | null; address: string | null }>(
    `select v.subject, ct.display_name,
            (select ci.identifier from contact_identities ci
              where ci.workspace_id=v.workspace_id and ci.contact_id=v.contact_id and ci.channel_type='email'
              order by ci.created_at asc limit 1) as address
     from conversations v
     left join contacts ct on ct.id=v.contact_id and ct.workspace_id=v.workspace_id
     where v.workspace_id=$1 and v.id=$2`,
    [workspaceId, conversationId],
  );
  const row = context.rows[0];
  if (!row?.address) throw new Error("Aucune adresse e-mail connue pour ce contact.");

  // Threading: Unipile takes the parent mail's provider id as `reply_to`.
  // The most recent message in the thread that carries one is the parent.
  const parent = await database.query<{ provider_id: string | null }>(
    `select metadata->>'emailProviderId' as provider_id from messages
     where workspace_id=$1 and conversation_id=$2 and metadata->>'emailProviderId' is not null
     order by effective_time desc limit 1`,
    [workspaceId, conversationId],
  );
  const replyTo = parent.rows[0]?.provider_id ?? undefined;

  const baseSubject = row.subject?.trim();
  // Per Unipile's send reference, a threaded reply keeps a "Re: " prefix.
  const subject = baseSubject
    ? (replyTo && !/^re\s*:/i.test(baseSubject) ? `Re: ${baseSubject}` : baseSubject)
    : undefined;

  const result = await sendEmail(config, {
    accountId: externalAccountId,
    to: [{ identifier: row.address, ...(row.display_name ? { display_name: row.display_name } : {}) }],
    body: text,
    ...(subject ? { subject } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  return { providerMessageId: result.providerId, subject: subject ?? null };
}

// --- First touch (controlled outbound to a known address, no thread yet) ---

export type FirstTouchResult =
  | { ok: true; conversationId: string | null; reason?: ReasonCode }
  | { ok: false; reason: ReasonCode };

// Everything a first touch needs, resolved from Talvia's own state — never
// from anything a client sent. Read as one query so a Contact that lost its
// email identity (or a workspace whose email account was disconnected)
// between campaign setup and execution is caught HERE, at send time, and not
// merely at audience-selection time (docs brief §13: never trust the
// frontend, re-check before every send).
type FirstTouchTarget = { address: string; displayName: string | null; connectionId: string; externalAccountId: string };

async function resolveFirstTouchTarget(workspaceId: string, contactId: string): Promise<{ target: FirstTouchTarget } | { reason: ReasonCode }> {
  const identity = await database.query<{ identifier: string; display_name: string | null }>(
    `select ci.identifier, ct.display_name
     from contact_identities ci
     join contacts ct on ct.id=ci.contact_id and ct.workspace_id=ci.workspace_id
     where ci.workspace_id=$1 and ci.contact_id=$2 and ci.channel_type='email' and ct.archived_at is null
     order by ci.created_at asc
     limit 1`,
    [workspaceId, contactId],
  );
  const identityRow = identity.rows[0];
  // normalizeEmail returns '' for anything that is not a real address — a
  // stored-but-unusable identifier must never reach the provider.
  if (!identityRow || !normalizeEmail(identityRow.identifier)) return { reason: "EMAIL_IDENTITY_MISSING" };

  const connection = await database.query<{ id: string; external_account_id: string }>(
    `select id,external_account_id from connections
     where workspace_id=$1 and provider=$2 and channel_type='email' and status='connected'
     order by created_at asc limit 1`,
    [workspaceId, PROVIDER],
  );
  const connectionRow = connection.rows[0];
  if (!connectionRow?.external_account_id) return { reason: "EMAIL_CONNECTION_UNAVAILABLE" };

  return { target: { address: identityRow.identifier, displayName: identityRow.display_name, connectionId: connectionRow.id, externalAccountId: connectionRow.external_account_id } };
}

// The Conversation a first touch writes into. Two rules, in order:
//
// 1. If this Contact already HAS an email Conversation on this connection,
//    use it. A first touch only means "no thread was known when the audience
//    was built" — an inbound mail (or a resync) may have created one since,
//    and a second Conversation for the same person is exactly the split this
//    whole design exists to prevent.
//
// 2. Otherwise create one with external_thread_id = NULL.
//
// NULL is the whole point, and it is not a placeholder: the column has been
// nullable since 005_inbox_persistence.sql, and NULL means precisely "the
// provider has not told us the thread yet". Putting the send response's
// `provider_id` there instead would file a MESSAGE identifier in a column
// whose unique(connection_id, external_thread_id) constraint defines THREAD
// identity — a value that then looks like a thread to every later reader and
// collides with nothing when the real thread arrives. Postgres treats NULLs
// as distinct under a unique constraint, so several provisional rows can
// coexist safely; reconcileOutboundSend above fills the real value in.
async function findOrCreateProvisionalEmailConversation(
  client: import("pg").PoolClient,
  workspaceId: string,
  connectionId: string,
  contactId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `select id from conversations
     where workspace_id=$1 and connection_id=$2 and contact_id=$3 and channel_type='email'
     order by coalesce(last_message_at,created_at) desc, created_at desc, id desc
     limit 1`,
    [workspaceId, connectionId, contactId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query<{ id: string }>(
    `insert into conversations(workspace_id,connection_id,contact_id,channel_type,external_thread_id,status)
     values($1,$2,$3,'email',null,'open') returning id`,
    [workspaceId, connectionId, contactId],
  );
  const conversationId = created.rows[0]!.id;
  await client.query(
    `insert into conversation_participants(conversation_id,contact_id,external_participant_id,role) values($1,$2,$3,'sender')
     on conflict(conversation_id,external_participant_id) do nothing`,
    [conversationId, contactId, contactId],
  );
  return conversationId;
}

// The first mail of a relationship: a real subject, a real recipient, a real
// body, and NO reply_to — there is no parent to thread onto yet, and
// inventing one would be inventing a provider identifier.
//
// Ordering is deliberate and not negotiable: the provider call happens
// BEFORE any transaction is opened (docs/product/ARCHITECTURE.md §31 — never
// hold a transaction across network I/O), and Talvia only writes what the
// provider actually confirmed. The Conversation carries NO thread id yet
// (external_thread_id stays NULL — see the helper above for why that is the
// honest representation rather than parking the message id there), and the
// message records threadResolution='pending_first_touch' plus the real
// `provider_id` the send returned. reconcileOutboundSend above fills in the
// canonical thread the moment the mail_sent webhook supplies it.
//
// When the provider returns no identifier at all, nothing is fabricated: the
// mail DID go out (so it must never be re-sent), no Conversation is created,
// and the caller is told so via EMAIL_THREAD_RECONCILIATION_FAILED on an
// otherwise successful result. The webhook then creates the Conversation
// normally, since there is no provisional row for it to reconcile against.
export async function sendFirstTouchEmail(args: {
  workspaceId: string;
  contactId: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
}): Promise<FirstTouchResult> {
  const config = getUnipileConfig();
  if (!config) return { ok: false, reason: "EMAIL_CONNECTION_UNAVAILABLE" };

  const subject = args.subject.trim();
  if (!subject) return { ok: false, reason: "EMAIL_SUBJECT_MISSING" };

  const resolved = await resolveFirstTouchTarget(args.workspaceId, args.contactId);
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  const { target } = resolved;

  let sent: Awaited<ReturnType<typeof sendEmail>>;
  try {
    sent = await sendEmail(config, {
      accountId: target.externalAccountId,
      to: [{ identifier: target.address, ...(target.displayName ? { display_name: target.displayName } : {}) }],
      subject,
      body: args.body,
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    });
  } catch (error) {
    // Two genuinely different outcomes, never conflated:
    //  - the provider ANSWERED and refused: nothing was sent, retrying is
    //    free, and the participant is immediately retry-eligible;
    //  - the provider never answered (timeout, dropped connection): whether a
    //    real person received this mail is UNKNOWN. Retrying it is the one
    //    path that can produce a second real email, and its only protection
    //    is the provider honouring the Idempotency-Key header. The caller is
    //    told which case this is so it does not retry an unknown outcome in
    //    the same minute.
    const providerAnswered = typeof error === "object" && error !== null && "providerAnswered" in error;
    console.error(`[unipile-email] first-touch send ${providerAnswered ? "refused" : "outcome unknown"} for contact ${args.contactId}`, error);
    return { ok: false, reason: providerAnswered ? "EMAIL_FIRST_TOUCH_SEND_FAILED" : "EMAIL_SEND_OUTCOME_UNKNOWN" };
  }

  if (!sent.providerId) return { ok: true, conversationId: null, reason: "EMAIL_THREAD_RECONCILIATION_FAILED" };

  const client = await database.connect();
  try {
    await client.query("begin");

    // The webhook (or a historical resync) can legitimately reach us BEFORE
    // this transaction runs — the provider fires mail_sent as soon as it
    // accepts, and that is a separate inbound HTTP request racing this one.
    // If the mail is already mirrored, this is not a second mail; adopt what
    // is there rather than writing a second Conversation and a second
    // message for one real email.
    const already = await client.query<{ conversation_id: string }>(
      `select m.conversation_id from messages m join conversations v on v.id=m.conversation_id
       where m.workspace_id=$1 and v.connection_id=$2 and m.metadata->>'emailProviderId'=$3
       limit 1`,
      [args.workspaceId, target.connectionId, sent.providerId],
    );
    if (already.rows[0]) {
      await client.query("commit");
      return { ok: true, conversationId: already.rows[0].conversation_id };
    }

    const conversationId = await findOrCreateProvisionalEmailConversation(client, args.workspaceId, target.connectionId, args.contactId);
    await client.query(`update conversations set subject=$2 where id=$1 and (subject is null or subject='')`, [conversationId, subject]);
    await client.query(
      `insert into messages(workspace_id,conversation_id,direction,body,status,provider_message_id,sent_at,metadata)
       values($1,$2,'outbound',$3,'sent',$4,now(),$5::jsonb)
       on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing`,
      [
        args.workspaceId,
        conversationId,
        args.body,
        sent.providerId,
        JSON.stringify({ subject, emailProviderId: sent.providerId, to: [target.address], threadResolution: "pending_first_touch" } satisfies EmailMessageMetadata),
      ],
    );
    await client.query(`update conversations set last_message_at=now(),updated_at=now() where id=$1`, [conversationId]);
    // Same conversation-level activity a threaded send records (see
    // unipile-adapter.ts's sendMessage). Without it, an Automation triggered
    // on 'message.sent' would fire for a relance and stay silent for a first
    // touch — the same business event behaving differently depending on
    // which delivery path happened to be used. Recorded inside the
    // transaction, dispatched only after it commits.
    const activity = await recordSystemActivity(args.workspaceId, {
      eventType: "message.sent",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { conversationId, connectionId: target.connectionId },
    }, client);
    await client.query("commit");
    await dispatchCommittedActivity(activity);
    return { ok: true, conversationId };
  } catch (error) {
    await client.query("rollback");
    // The mail is already out. Reporting this as a send failure would make
    // the engine retry a message a real person has received, so it is
    // reported as what it is: sent, mirror not written, reconcilable by the
    // webhook.
    console.error(`[unipile-email] first-touch persistence failed for contact ${args.contactId}`, error);
    return { ok: true, conversationId: null, reason: "EMAIL_THREAD_RECONCILIATION_FAILED" };
  } finally {
    client.release();
  }
}

// --- Historical import ---
// Shares the chat backfill's discipline (provider fetch outside the
// transaction, short write transactions, idempotent upsert, imported=true,
// no live business side effects) without sharing its code, which is built
// around chats/attendees that do not exist for mail.

export type EmailBackfillResult = { messagesInserted: number; threadsTouched: number };

// metadata.imported=true marks these as historical: they must never trigger
// reply-stop, automations, or any other live reaction reserved for a genuine
// new inbound. That is enforced structurally here — this function simply
// never calls stopParticipantsOnReply — rather than by a flag some future
// caller could forget to pass.
type ImportableEmail = {
  threadKey: string;
  direction: "inbound" | "outbound";
  address: string;
  normalizedAddress: string;
  displayName: string;
  email: UnipileEmail;
};

// Pure, no I/O: decides what a raw provider email means before any
// connection is opened. An email with no thread key or no resolvable
// counterparty is skipped rather than failing the page — the same tolerance
// the per-email version had, kept deliberately.
function toImportable(email: UnipileEmail): ImportableEmail | null {
  const threadKey = email.thread_id ?? email.message_id ?? email.id;
  if (!threadKey) return null;
  // role is the provider's own folder classification; 'sent' is the only one
  // that unambiguously means we authored it.
  const direction = email.role === "sent" ? "outbound" : "inbound";
  const counterparty = direction === "inbound" ? email.from_attendee : email.to_attendees?.[0];
  const address = attendeeAddress(counterparty);
  if (!address) return null;
  return { threadKey, direction, address, normalizedAddress: normalizeEmail(address), displayName: counterparty?.display_name ?? "", email };
}

function importedMetadata(item: ImportableEmail): string {
  const { email, direction, address } = item;
  return JSON.stringify({
    ...(email.subject ? { subject: email.subject } : {}),
    ...(email.message_id ? { emailMessageId: email.message_id } : {}),
    ...(email.provider_id ? { emailProviderId: email.provider_id } : {}),
    ...(direction === "inbound" ? { from: address } : {}),
    ...(email.attachments?.length ? { attachments: email.attachments.map((a) => ({ id: a.id, ...(a.name ? { name: a.name } : {}), ...(a.mime ? { mime: a.mime } : {}) })) } : {}),
    imported: true,
  } satisfies EmailMessageMetadata);
}

type ImportedMessageRow = {
  workspaceId: string; conversationId: string; direction: "inbound" | "outbound";
  senderContactId: string | null; body: string; status: "sent" | "received";
  providerMessageId: string; timestamp: string; metadataJson: string;
};

// ONE multi-row INSERT for a whole page instead of one round trip per email.
// Same idempotence as before — ON CONFLICT DO NOTHING on
// (conversation_id, provider_message_id) — and `returning` still yields
// exactly the rows that were genuinely new, which is what the caller counts.
// DO NOTHING rather than the chat backfill's DO UPDATE: a historical email is
// immutable here, and re-importing must never rewrite a row (nor clear its
// imported flag).
function buildImportedEmailInsert(rows: ImportedMessageRow[]): { sql: string; params: unknown[] } {
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((row, index) => {
    const base = index * 9;
    const [p1, p2, p3, p4, p5, p6, p7, p8, p9] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => base + n);
    values.push(`($${p1},$${p2},$${p3},$${p4},$${p5},$${p6},$${p7},case when $${p3}::varchar='outbound' then $${p8}::timestamptz else null end,case when $${p3}::varchar='inbound' then $${p8}::timestamptz else null end,$${p9}::jsonb)`);
    params.push(row.workspaceId, row.conversationId, row.direction, row.senderContactId, row.body, row.status, row.providerMessageId, row.timestamp, row.metadataJson);
  });
  return {
    sql: `insert into messages(workspace_id,conversation_id,direction,sender_contact_id,body,status,provider_message_id,sent_at,received_at,metadata)
     values ${values.join(",")}
     on conflict(conversation_id,provider_message_id) where provider_message_id is not null do nothing
     returning id,conversation_id,provider_message_id`,
    params,
  };
}

export async function persistImportedEmails(workspaceId: string, connectionId: string, emails: UnipileEmail[]): Promise<EmailBackfillResult> {
  // Decided before opening anything — no connection is held while parsing.
  const items = emails.map(toImportable).filter((item): item is ImportableEmail => item !== null);
  if (!items.length) return { messagesInserted: 0, threadsTouched: 0 };

  // ONE connection and ONE short transaction for the whole page. The previous
  // version opened a connection and a transaction PER EMAIL, which measured
  // ~1 message/second against Neon on the first real Gmail import — the round
  // trips, not the work, were the cost. No provider call happens in here:
  // the page was already fetched by the caller, so this transaction never
  // spans network I/O.
  const client = await database.connect();
  try {
    await client.query("begin");

    // A mail Talvia itself sent is already mirrored locally, keyed on the
    // send response's provider_id — a DIFFERENT key from the email_id this
    // import uses, so ON CONFLICT cannot see it and the page would insert a
    // second row for one real email. Only OUTBOUND mails can have been
    // mirrored that way, so the lookup is restricted to those and skipped
    // entirely when a page has none (the overwhelmingly common case, and
    // always the case on a first backfill).
    const outboundProviderIds = items
      .filter((item) => item.direction === "outbound" && item.email.provider_id)
      .map((item) => item.email.provider_id!);
    let alreadyMirrored = new Set<string>();
    if (outboundProviderIds.length) {
      const mirrored = await client.query<{ pid: string }>(
        `select m.metadata->>'emailProviderId' as pid
         from messages m join conversations v on v.id=m.conversation_id
         where m.workspace_id=$1 and v.connection_id=$2 and m.direction='outbound'
           and m.metadata->>'emailProviderId' = any($3::text[])`,
        [workspaceId, connectionId, outboundProviderIds],
      );
      alreadyMirrored = new Set(mirrored.rows.map((row) => row.pid));
    }

    // Within one page the same address and the same thread recur constantly
    // (a thread is several emails). Resolving each once collapses the bulk of
    // the remaining per-email round trips, and makes a thread's Contact
    // stable across the page instead of being rewritten by each message.
    const contactByAddress = new Map<string, string>();
    const conversationByThread = new Map<string, string>();
    const rows: ImportedMessageRow[] = [];

    for (const item of items) {
      if (item.email.provider_id && alreadyMirrored.has(item.email.provider_id)) continue;
      let contactId = contactByAddress.get(item.normalizedAddress);
      if (!contactId) {
        contactId = await findOrCreateContact(client, workspaceId, "email", item.address, undefined, item.displayName);
        contactByAddress.set(item.normalizedAddress, contactId);
      }

      let conversationId = conversationByThread.get(item.threadKey);
      if (!conversationId) {
        conversationId = await findOrCreateConversation(client, workspaceId, connectionId, "email", item.threadKey, contactId);
        conversationByThread.set(item.threadKey, conversationId);
        if (item.email.subject) {
          // First subject seen wins — a "Re:" must not rewrite the original.
          await client.query(`update conversations set subject=$2 where id=$1 and (subject is null or subject='')`, [conversationId, item.email.subject]);
        }
      }

      rows.push({
        workspaceId,
        conversationId,
        direction: item.direction,
        senderContactId: item.direction === "inbound" ? contactId : null,
        body: toPlainTextBody(item.email),
        status: item.direction === "inbound" ? "received" : "sent",
        providerMessageId: item.email.id,
        timestamp: item.email.date,
        metadataJson: importedMetadata(item),
      });
    }

    // A page can now legitimately end up with nothing to write (every mail on
    // it was already mirrored by a Talvia send). buildImportedEmailInsert on
    // an empty list would emit `values ` with no tuples — a syntax error.
    if (!rows.length) {
      await client.query("commit");
      return { messagesInserted: 0, threadsTouched: conversationByThread.size };
    }

    const insert = buildImportedEmailInsert(rows);
    const inserted = await client.query<{ id: string; conversation_id: string; provider_message_id: string }>(insert.sql, insert.params);

    // Only conversations that actually received a new message move their
    // last_message_at, exactly as before — and only to the newest date among
    // the rows just inserted, applied in ONE statement rather than one per
    // message. greatest() keeps this monotonic against realtime ingestion.
    const newestByConversation = new Map<string, string>();
    const dateByProviderId = new Map(rows.map((row) => [row.providerMessageId, row.timestamp]));
    for (const row of inserted.rows) {
      const date = dateByProviderId.get(row.provider_message_id);
      if (!date) continue;
      const current = newestByConversation.get(row.conversation_id);
      if (!current || current < date) newestByConversation.set(row.conversation_id, date);
    }
    if (newestByConversation.size) {
      await client.query(
        `update conversations c set last_message_at=greatest(coalesce(c.last_message_at,v.ts),v.ts),updated_at=now()
         from (select unnest($1::uuid[]) as id, unnest($2::timestamptz[]) as ts) v
         where c.id=v.id`,
        [[...newestByConversation.keys()], [...newestByConversation.values()]],
      );
    }

    await client.query("commit");
    return { messagesInserted: inserted.rows.length, threadsTouched: conversationByThread.size };
  } catch (error) {
    // A page fails as a unit and is re-tried whole on the next run — safe
    // precisely because every insert is idempotent. The error is never
    // swallowed: it propagates to backfillConnectionHistory, which counts the
    // page as failed and logs it.
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
