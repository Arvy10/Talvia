import { database } from "../database";
import { dispatchCommittedActivity, recordSystemActivity } from "../activities";
import {
  findOrCreateContact,
  findOrCreateConversation,
  stopParticipantsOnReply,
  PROVIDER,
  type IngestResult,
} from "./unipile-adapter";
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
  threadResolution?: "provider_thread_id" | "fallback_message_id";
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
export async function persistImportedEmails(workspaceId: string, connectionId: string, emails: UnipileEmail[]): Promise<EmailBackfillResult> {
  let messagesInserted = 0;
  const threadsTouched = new Set<string>();

  for (const email of emails) {
    const threadKey = email.thread_id ?? email.message_id ?? email.id;
    if (!threadKey) continue;
    // role is the provider's own folder classification; 'sent' is the only
    // one that unambiguously means we authored it.
    const direction = email.role === "sent" ? "outbound" : "inbound";
    const counterparty = direction === "inbound" ? email.from_attendee : email.to_attendees?.[0];
    const address = attendeeAddress(counterparty);
    if (!address) continue;

    const client = await database.connect();
    try {
      await client.query("begin");
      const contactId = await findOrCreateContact(client, workspaceId, "email", address, undefined, counterparty?.display_name ?? "");
      const conversationId = await findOrCreateConversation(client, workspaceId, connectionId, "email", threadKey, contactId);
      if (email.subject) {
        await client.query(`update conversations set subject=$2 where id=$1 and (subject is null or subject='')`, [conversationId, email.subject]);
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
          toPlainTextBody(email),
          direction === "inbound" ? "received" : "sent",
          email.id,
          email.date,
          JSON.stringify({
            ...(email.subject ? { subject: email.subject } : {}),
            ...(email.message_id ? { emailMessageId: email.message_id } : {}),
            ...(email.provider_id ? { emailProviderId: email.provider_id } : {}),
            ...(address ? { from: direction === "inbound" ? address : undefined } : {}),
            ...(email.attachments?.length ? { attachments: email.attachments.map((a) => ({ id: a.id, ...(a.name ? { name: a.name } : {}), ...(a.mime ? { mime: a.mime } : {}) })) } : {}),
            imported: true,
          } satisfies EmailMessageMetadata),
        ],
      );
      if (inserted.rows[0]) {
        messagesInserted += 1;
        await client.query(
          `update conversations set last_message_at=greatest(coalesce(last_message_at,$2::timestamptz),$2::timestamptz),updated_at=now() where id=$1`,
          [conversationId, email.date],
        );
      }
      threadsTouched.add(threadKey);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return { messagesInserted, threadsTouched: threadsTouched.size };
}
