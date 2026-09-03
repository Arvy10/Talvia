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

    // Within one page the same address and the same thread recur constantly
    // (a thread is several emails). Resolving each once collapses the bulk of
    // the remaining per-email round trips, and makes a thread's Contact
    // stable across the page instead of being rewritten by each message.
    const contactByAddress = new Map<string, string>();
    const conversationByThread = new Map<string, string>();
    const rows: ImportedMessageRow[] = [];

    for (const item of items) {
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
