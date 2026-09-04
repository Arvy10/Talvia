import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnipileEmail, UnipileNewEmailPayload } from "./unipile";

// Fake DB by SQL prefix — same approach as unipile-adapter.test.ts, covering
// only the query shapes email ingestion actually issues (connections,
// contact_identities, contacts, conversations, conversation_participants,
// messages, campaign_participants, activities).
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const contactIdentities: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const conversationParticipants: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;
  let openTransactions = 0;
  // Counters proving the transactional N+1 is gone: a page must cost ONE
  // connection and ONE transaction, not one per email.
  let connectCount = 0;
  let beginCount = 0;
  let batchInsertCount = 0;
  // Proves no provider fetch is ever held inside an open transaction.
  const transactionDepth = () => openTransactions;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin") { openTransactions += 1; beginCount += 1; return { rows: [] }; }
    if (text === "commit" || text === "rollback") { openTransactions -= 1; return { rows: [] }; }

    if (text.startsWith("select id,workspace_id,channel_type from connections where provider=$1 and external_account_id=$2")) {
      const [provider, accountId] = params as string[];
      const row = connections.find((c) => c.provider === provider && c.external_account_id === accountId);
      return { rows: row ? [{ id: row.id, workspace_id: row.workspace_id, channel_type: row.channel_type }] : [] };
    }

    if (text.startsWith("select contact_id from contact_identities where workspace_id=$1 and channel_type=$3 and identifier_normalized=$2")) {
      const [workspaceId, normalized, channelType] = params as string[];
      const row = contactIdentities.find((i) => i.workspace_id === workspaceId && i.channel_type === channelType && i.identifier_normalized === normalized);
      return { rows: row ? [{ contact_id: row.contact_id }] : [] };
    }
    if (text.startsWith("update contact_identities set metadata=")) return { rows: [] };
    if (text.startsWith("update contacts set job_title=")) return { rows: [] };
    if (text.startsWith("insert into contacts(")) {
      const [workspaceId, firstName, lastName, displayName] = params as string[];
      const row = { id: nextId("contact"), workspace_id: workspaceId, first_name: firstName, last_name: lastName, display_name: displayName };
      contacts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("insert into contact_identities(")) {
      const [workspaceId, contactId, , identifier, identifierNormalized, , , channelType] = params as string[];
      contactIdentities.push({ workspace_id: workspaceId, contact_id: contactId, channel_type: channelType, identifier, identifier_normalized: identifierNormalized });
      return { rows: [] };
    }

    // --- first touch (sendFirstTouchEmail) ---
    // The cross-path "is this mail already mirrored?" guard. emailProviderId
    // is the one identifier the send response, the webhook and the historical
    // import all carry.
    if (text.startsWith("select m.conversation_id from messages m join conversations v on v.id=m.conversation_id")) {
      const [ws, connectionId, providerId] = params as string[];
      const row = messages.find((m) => {
        const conversation = conversations.find((c) => c.id === m.conversation_id);
        return m.workspace_id === ws && conversation?.connection_id === connectionId && (m.metadata as Record<string, unknown>)?.emailProviderId === providerId;
      });
      return { rows: row ? [{ conversation_id: row.conversation_id }] : [] };
    }
    // The Contact's canonical email Conversation on this connection, if any —
    // a first touch adopts it rather than opening a second one.
    if (text.startsWith("select id from conversations where workspace_id=$1 and connection_id=$2 and contact_id=$3 and channel_type='email'")) {
      const [ws, connectionId, contactId] = params as string[];
      const row = conversations.find((c) => c.workspace_id === ws && c.connection_id === connectionId && c.contact_id === contactId && c.channel_type === "email");
      return { rows: row ? [{ id: row.id }] : [] };
    }
    // The provisional Conversation: external_thread_id is genuinely NULL, not
    // a stand-in value.
    if (text.startsWith("insert into conversations(workspace_id,connection_id,contact_id,channel_type,external_thread_id,status) values($1,$2,$3,'email',null,'open')")) {
      const [ws, connectionId, contactId] = params as string[];
      const row = { id: nextId("conv"), workspace_id: ws, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: null as string | null, subject: null as string | null, last_message_at: null as string | null, status: "open" };
      conversations.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("select ci.identifier, ct.display_name from contact_identities ci")) {
      const [ws, contactId] = params as string[];
      const identity = contactIdentities.find((i) => i.workspace_id === ws && i.contact_id === contactId && i.channel_type === "email");
      const contact = contacts.find((c) => c.id === contactId);
      return { rows: identity ? [{ identifier: identity.identifier, display_name: contact?.display_name ?? null }] : [] };
    }
    if (text.startsWith("select id,external_account_id from connections where workspace_id=$1 and provider=$2 and channel_type='email' and status='connected'")) {
      const [ws, provider] = params as string[];
      const row = connections.find((c) => c.workspace_id === ws && c.provider === provider && c.channel_type === "email" && c.status === "connected");
      return { rows: row ? [{ id: row.id, external_account_id: row.external_account_id }] : [] };
    }
    if (text.startsWith("insert into messages(workspace_id,conversation_id,direction,body,status,provider_message_id,sent_at,metadata)")) {
      const [ws, conversationId, body, providerMessageId, metadataJson] = params as string[];
      if (messages.some((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId)) return { rows: [] };
      const row = { id: nextId("msg"), workspace_id: ws, conversation_id: conversationId, direction: "outbound", sender_contact_id: null, body, status: "sent", provider_message_id: providerMessageId, date: new Date().toISOString(), metadata: JSON.parse(metadataJson) };
      messages.push(row);
      return { rows: [] };
    }
    if (text.startsWith("update conversations set last_message_at=now(),updated_at=now() where id=$1")) {
      const [id] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row) row.last_message_at = new Date().toISOString();
      return { rows: [] };
    }

    // --- threaded send (sendEmailForConversation) ---
    if (text.startsWith("select v.subject, ct.display_name,")) {
      const [ws, conversationId] = params as string[];
      const conversation = conversations.find((c) => c.id === conversationId && c.workspace_id === ws);
      if (!conversation) return { rows: [] };
      const contact = contacts.find((c) => c.id === conversation.contact_id);
      const identity = contactIdentities.find((i) => i.workspace_id === ws && i.contact_id === conversation.contact_id && i.channel_type === "email");
      return { rows: [{ subject: conversation.subject ?? null, display_name: contact?.display_name ?? null, address: identity?.identifier ?? null }] };
    }
    if (text.startsWith("select metadata->>'emailProviderId' as provider_id from messages")) {
      const [ws, conversationId] = params as string[];
      const row = messages
        .filter((m) => m.workspace_id === ws && m.conversation_id === conversationId && (m.metadata as Record<string, unknown>)?.emailProviderId)
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))[0];
      return { rows: row ? [{ provider_id: (row.metadata as Record<string, string>).emailProviderId }] : [] };
    }

    // --- outbound reconciliation (reconcileOutboundSend) ---
    if (text.startsWith("select m.id,m.conversation_id,v.external_thread_id from messages m join conversations v")) {
      const [ws, connectionId, providerId] = params as string[];
      const row = messages.find((m) => {
        const conversation = conversations.find((c) => c.id === m.conversation_id);
        const metadata = m.metadata as Record<string, unknown>;
        return m.workspace_id === ws && conversation?.connection_id === connectionId
          && metadata?.emailProviderId === providerId;
      });
      if (!row) return { rows: [] };
      const conversation = conversations.find((c) => c.id === row.conversation_id)!;
      return { rows: [{ id: row.id, conversation_id: row.conversation_id, external_thread_id: conversation.external_thread_id }] };
    }
    if (text.startsWith("select id from conversations where connection_id=$1 and external_thread_id=$2")) {
      const [connectionId, threadId] = params as string[];
      const row = conversations.find((c) => c.connection_id === connectionId && c.external_thread_id === threadId);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.startsWith("update conversations set external_thread_id=$2")) {
      const [id, threadId] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row) row.external_thread_id = threadId;
      return { rows: [] };
    }
    if (text.startsWith("select id from messages where conversation_id=$1 and (provider_message_id=$2 or metadata->>'emailProviderId'=$3)")) {
      const [conversationId, providerMessageId, providerId] = params as string[];
      const row = messages.find((m) => m.conversation_id === conversationId && (m.provider_message_id === providerMessageId || (m.metadata as Record<string, unknown>)?.emailProviderId === providerId));
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.startsWith("update messages set conversation_id=$2 where id=$1")) {
      const [id, conversationId] = params as string[];
      const row = messages.find((m) => m.id === id);
      if (row) row.conversation_id = conversationId;
      return { rows: [] };
    }
    if (text.startsWith("update conversations set status='archived'")) {
      const [id] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row && row.external_thread_id === null && !messages.some((m) => m.conversation_id === id)) row.status = "archived";
      return { rows: [] };
    }
    // Historical import's cross-path guard.
    if (text.startsWith("select m.metadata->>'emailProviderId' as pid from messages m join conversations v")) {
      const [ws, connectionId, providerIds] = params as [string, string, string[]];
      const rows = messages.filter((m) => {
        const conversation = conversations.find((c) => c.id === m.conversation_id);
        return m.workspace_id === ws && conversation?.connection_id === connectionId && m.direction === "outbound"
          && providerIds.includes(String((m.metadata as Record<string, unknown>)?.emailProviderId ?? ""));
      });
      return { rows: rows.map((m) => ({ pid: (m.metadata as Record<string, string>).emailProviderId })) };
    }
    if (text.startsWith("select id from messages where conversation_id=$1 and provider_message_id=$2 and id<>$3")) {
      const [conversationId, providerMessageId, excludeId] = params as string[];
      const row = messages.find((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId && m.id !== excludeId);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.startsWith("update messages set provider_message_id=case when $4")) {
      const [id, emailId, patchJson, taken] = params as [string, string, string, boolean];
      const row = messages.find((m) => m.id === id);
      if (row) {
        if (!taken) row.provider_message_id = emailId;
        row.metadata = { ...(row.metadata as Record<string, unknown>), ...JSON.parse(patchJson) };
      }
      return { rows: [] };
    }

    if (text.startsWith("select id,contact_id from conversations where connection_id=$1 and external_thread_id=$2")) {
      const [connectionId, threadId] = params as string[];
      const row = conversations.find((c) => c.connection_id === connectionId && c.external_thread_id === threadId);
      return { rows: row ? [{ id: row.id, contact_id: row.contact_id }] : [] };
    }
    if (text.startsWith("update conversations set contact_id=$2")) {
      const [id, contactId] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row) row.contact_id = contactId;
      return { rows: [] };
    }
    if (text.startsWith("delete from conversation_participants")) return { rows: [] };
    if (text.startsWith("insert into conversations(")) {
      const [workspaceId, connectionId, contactId, channelType, externalThreadId] = params as string[];
      const row = { id: nextId("conv"), workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: channelType, external_thread_id: externalThreadId, subject: null as string | null, last_message_at: null as string | null };
      conversations.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("insert into conversation_participants(")) {
      const [conversationId, contactId] = params as string[];
      conversationParticipants.push({ conversation_id: conversationId, contact_id: contactId });
      return { rows: [] };
    }
    if (text.startsWith("update conversations set subject=$2 where id=$1 and (subject is null or subject='')")) {
      const [id, subject] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row && !row.subject) row.subject = subject;
      return { rows: [] };
    }
    if (text.startsWith("update conversations set last_message_at=greatest(")) {
      const [id, date] = params as string[];
      const row = conversations.find((c) => c.id === id);
      if (row) row.last_message_at = !row.last_message_at || (row.last_message_at as string) < date ? date : row.last_message_at;
      return { rows: [] };
    }

    if (text.startsWith("update conversations c set last_message_at=greatest(coalesce(c.last_message_at,v.ts),v.ts)")) {
      const [ids, ts] = params as [string[], string[]];
      ids.forEach((id, i) => { const row = conversations.find((c) => c.id === id); if (row && (!row.last_message_at || (row.last_message_at as string) < ts[i]!)) row.last_message_at = ts[i]; });
      return { rows: [] };
    }
    // Serves BOTH shapes: the realtime path's single row and the backfill's
    // multi-row batch. Params always arrive in groups of 9, so the batch is
    // simply N groups — mirroring ON CONFLICT DO NOTHING per row.
    if (text.startsWith("insert into messages(")) {
      if (params.length > 9) batchInsertCount += 1;
      const inserted: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < params.length; offset += 9) {
        const [workspaceId, conversationId, direction, senderContactId, body, status, providerMessageId, date, metadataJson] = params.slice(offset, offset + 9) as string[];
        if (messages.some((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId)) continue;
        const row = { id: nextId("msg"), workspace_id: workspaceId, conversation_id: conversationId, direction, sender_contact_id: senderContactId, body, status, provider_message_id: providerMessageId, date, metadata: metadataJson ? JSON.parse(metadataJson) : {} };
        messages.push(row);
        inserted.push({ id: row.id, conversation_id: conversationId, provider_message_id: providerMessageId });
      }
      return { rows: inserted };
    }

    // stopParticipantsOnReply — imported verbatim from unipile-adapter.ts, so
    // this mirrors its real channel-scoped WHERE clause exactly.
    if (text.startsWith("update campaign_participants p set status='replied'")) {
      const [contactId, workspaceId, channelType, excluded] = params as [string, string, string, string[]];
      const stopped = campaignParticipants.filter((p) => {
        const campaign = campaigns.find((c) => c.id === p.campaign_id);
        return p.contact_id === contactId
          && campaign?.workspace_id === workspaceId
          && campaign?.channel_type === channelType
          && ["active", "completed"].includes(p.status as string)
          && !p.replied_at
          && (channelType !== "linkedin" || Boolean(p.invite_accepted_at))
          && !excluded.includes(p.id as string);
      });
      for (const p of stopped) { p.status = "replied"; p.replied_at = new Date().toISOString(); }
      return { rows: stopped.map((p) => ({ id: p.id, campaign_id: p.campaign_id })) };
    }

    if (text.startsWith("insert into activities")) {
      const [workspaceId, eventType, entityType, entityId] = params as string[];
      const row = { id: nextId("activity"), workspace_id: workspaceId, event_type: eventType, entity_type: entityType, entity_id: entityId, created_at: new Date().toISOString() };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return {
    query,
    connect: async () => { connectCount += 1; return { query, release: () => {} }; },
    get connectCount() { return connectCount; },
    get beginCount() { return beginCount; },
    get batchInsertCount() { return batchInsertCount; },
    connections, contacts, contactIdentities, conversations, conversationParticipants, messages, campaigns, campaignParticipants, activities,
    transactionDepth,
  };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

// The provider lookup that resolves a webhook's thread — a real network call,
// mocked so these tests exercise the ingestion logic, not Unipile.
const getEmailByMessageIdMock = vi.hoisted(() => vi.fn(async () => null as { thread_id?: string } | null));
// The only irreversible call in this module — a real person receives a real
// mail — mocked so these tests exercise Talvia's own resolution, persistence
// and reconciliation, never Unipile.
const sendEmailMock = vi.hoisted(() => vi.fn(async (_config: unknown, _params: { accountId: string; to: Array<{ identifier: string }>; body: string; subject?: string; replyTo?: string; idempotencyKey?: string }) => ({ providerId: "provider-sent-1" as string | null, trackingId: null as string | null })));
vi.mock("./unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  getEmailByMessageId: getEmailByMessageIdMock,
  sendEmail: sendEmailMock,
}));

const dispatchCommittedActivityMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../activities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../activities")>()),
  dispatchCommittedActivity: dispatchCommittedActivityMock,
}));

const { ingestEmail, persistImportedEmails, sendEmailForConversation, sendFirstTouchEmail, toPlainTextBody } = await import("./unipile-email");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  getEmailByMessageIdMock.mockReset().mockResolvedValue({ thread_id: "thread-1" });
  sendEmailMock.mockReset().mockResolvedValue({ providerId: "provider-sent-1", trackingId: null });
  dispatchCommittedActivityMock.mockClear();
});

const workspaceId = "ws-1";
const accountId = "acct-google-1";

function seedEmailConnection(channelType = "email", forWorkspaceId = workspaceId, externalAccountId = accountId) {
  fakeDatabase.connections.push({ id: `conn-${externalAccountId}`, workspace_id: forWorkspaceId, provider: "unipile", channel_type: channelType, external_account_id: externalAccountId });
  return `conn-${externalAccountId}`;
}

function emailPayload(overrides: Partial<UnipileNewEmailPayload> = {}): UnipileNewEmailPayload {
  return {
    email_id: "unipile-email-1",
    account_id: accountId,
    event: "mail_received",
    date: "2026-03-01T10:00:00.000Z",
    message_id: "<rfc-1@mail.example>",
    provider_id: "provider-1",
    subject: "Votre devis",
    body_plain: "Bonjour, le devis m'intéresse.",
    from_attendee: { display_name: "Marc Durand", identifier: "Marc.Durand@Example.com" },
    to_attendees: [{ display_name: "Moi", identifier: "moi@talvia.app" }],
    ...overrides,
  };
}

function seedCampaignParticipant(campaignChannel: string, contactId: string, status = "active") {
  const campaignId = `camp-${campaignChannel}`;
  if (!fakeDatabase.campaigns.some((c) => c.id === campaignId)) {
    fakeDatabase.campaigns.push({ id: campaignId, workspace_id: workspaceId, channel_type: campaignChannel });
  }
  const participant = { id: `part-${campaignChannel}`, campaign_id: campaignId, contact_id: contactId, status, replied_at: null as string | null, invite_accepted_at: campaignChannel === "linkedin" ? new Date().toISOString() : null };
  fakeDatabase.campaignParticipants.push(participant);
  return participant;
}

describe("ingestEmail — identity, threading, persistence", () => {
  it("creates the Contact, Conversation and inbound Message from a received mail", async () => {
    seedEmailConnection();

    const result = await ingestEmail(emailPayload());

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("thread-1");
    expect(fakeDatabase.conversations[0]!.channel_type).toBe("email");
    expect(fakeDatabase.conversations[0]!.subject).toBe("Votre devis");
    const message = fakeDatabase.messages[0]!;
    expect(message.direction).toBe("inbound");
    expect(message.status).toBe("received");
    expect(message.body).toBe("Bonjour, le devis m'intéresse.");
    expect(message.provider_message_id).toBe("unipile-email-1");
  });

  it("files the email identity under channel_type='email' with the same normalization contacts.ts uses", async () => {
    seedEmailConnection();

    await ingestEmail(emailPayload());

    const identity = fakeDatabase.contactIdentities[0]!;
    expect(identity.channel_type).toBe("email");
    // Mixed case in the payload, lowercase in the index — this is what makes
    // an inbound mail resolve to a Contact the user already typed in by hand.
    expect(identity.identifier_normalized).toBe("marc.durand@example.com");
  });

  it("reuses an existing Contact whose email identity was created by hand — never a duplicate", async () => {
    seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-existing", workspace_id: workspaceId, display_name: "Marc Durand" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-existing", channel_type: "email", identifier: "marc.durand@example.com", identifier_normalized: "marc.durand@example.com" });

    await ingestEmail(emailPayload());

    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.conversations[0]!.contact_id).toBe("contact-existing");
  });

  it("uses the provider's canonical thread_id, resolved outside any open transaction", async () => {
    seedEmailConnection();
    let depthDuringFetch = -1;
    getEmailByMessageIdMock.mockImplementation(async () => {
      depthDuringFetch = fakeDatabase.transactionDepth();
      return { thread_id: "thread-canonical" };
    });

    await ingestEmail(emailPayload());

    expect(depthDuringFetch).toBe(0); // no DB transaction held across the network call
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("thread-canonical");
    expect(fakeDatabase.messages[0]!.metadata).toMatchObject({ threadResolution: "provider_thread_id" });
  });

  it("falls back to the RFC message id as thread key when the provider returns no match, and records that it did", async () => {
    seedEmailConnection();
    getEmailByMessageIdMock.mockResolvedValue(null);

    await ingestEmail(emailPayload());

    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("<rfc-1@mail.example>");
    expect(fakeDatabase.messages[0]!.metadata).toMatchObject({ threadResolution: "fallback_message_id" });
  });

  it("groups a later mail in the same thread into the same Conversation", async () => {
    seedEmailConnection();
    await ingestEmail(emailPayload());

    await ingestEmail(emailPayload({ email_id: "unipile-email-2", message_id: "<rfc-2@mail.example>", subject: "Re: Votre devis", body_plain: "Une relance." }));

    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.messages).toHaveLength(2);
    expect(fakeDatabase.conversations[0]!.subject).toBe("Votre devis"); // "Re:" never overwrites the original
  });

  it("treats a sent mail as outbound, with the recipient as the counterparty", async () => {
    seedEmailConnection();

    await ingestEmail(emailPayload({
      event: "mail_sent",
      from_attendee: { identifier: "moi@talvia.app" },
      to_attendees: [{ display_name: "Marc Durand", identifier: "marc.durand@example.com" }],
    }));

    expect(fakeDatabase.messages[0]!.direction).toBe("outbound");
    expect(fakeDatabase.messages[0]!.status).toBe("sent");
    expect(fakeDatabase.messages[0]!.sender_contact_id).toBeNull();
    expect(fakeDatabase.contactIdentities[0]!.identifier_normalized).toBe("marc.durand@example.com");
  });

  it("stores a plain-text body and never raw provider HTML", async () => {
    seedEmailConnection();

    await ingestEmail(emailPayload({ body_plain: undefined, body: "<p>Bonjour <b>Marc</b></p><script>alert(1)</script>" }));

    const body = fakeDatabase.messages[0]!.body as string;
    expect(body).toBe("Bonjour Marc");
    expect(body).not.toContain("<");
    expect(body).not.toContain("script");
  });
});

describe("ingestEmail — idempotence and guards", () => {
  it("is idempotent: the same webhook delivered twice yields one business message", async () => {
    seedEmailConnection();

    const first = await ingestEmail(emailPayload());
    const second = await ingestEmail(emailPayload());

    expect(first.status).toBe("ingested");
    expect(second.status).toBe("duplicate");
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("ignores mail_moved — a folder change is not a new business message", async () => {
    seedEmailConnection();

    const result = await ingestEmail(emailPayload({ event: "mail_moved" }));

    expect(result).toEqual({ status: "ignored" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("returns unknown_account for an account with no connection", async () => {
    const result = await ingestEmail(emailPayload({ account_id: "acct-never-seen" }));

    expect(result).toEqual({ status: "unknown_account" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("refuses to ingest mail against a non-email connection", async () => {
    seedEmailConnection("whatsapp");

    const result = await ingestEmail(emailPayload());

    expect(result).toEqual({ status: "unknown_account" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("ignores a mail with no resolvable counterparty rather than inventing one", async () => {
    seedEmailConnection();

    const result = await ingestEmail(emailPayload({ from_attendee: undefined }));

    expect(result).toEqual({ status: "ignored" });
    expect(fakeDatabase.contacts).toHaveLength(0);
  });
});

describe("ingestEmail — reply-stop (channel-aware)", () => {
  it("stops the contact's active EMAIL participant on a real inbound reply", async () => {
    seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "marc.durand@example.com" });
    const participant = seedCampaignParticipant("email", "contact-1");

    await ingestEmail(emailPayload());

    expect(participant.status).toBe("replied");
    expect(participant.replied_at).not.toBeNull();
  });

  it("never stops a WhatsApp or LinkedIn participant for the same Contact", async () => {
    seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "marc.durand@example.com" });
    const whatsapp = seedCampaignParticipant("whatsapp", "contact-1");
    const linkedin = seedCampaignParticipant("linkedin", "contact-1");
    const email = seedCampaignParticipant("email", "contact-1");

    await ingestEmail(emailPayload());

    expect(email.status).toBe("replied");
    expect(whatsapp.status).toBe("active");
    expect(linkedin.status).toBe("active");
  });

  it("does not stop anything on an outbound mail we sent ourselves", async () => {
    seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "marc.durand@example.com" });
    const participant = seedCampaignParticipant("email", "contact-1");

    await ingestEmail(emailPayload({
      event: "mail_sent",
      from_attendee: { identifier: "moi@talvia.app" },
      to_attendees: [{ identifier: "marc.durand@example.com" }],
    }));

    expect(participant.status).toBe("active");
  });

  it("never stops a participant belonging to another workspace", async () => {
    seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "marc.durand@example.com" });
    fakeDatabase.campaigns.push({ id: "camp-other-ws", workspace_id: "ws-2", channel_type: "email" });
    const foreign = { id: "part-other-ws", campaign_id: "camp-other-ws", contact_id: "contact-1", status: "active", replied_at: null, invite_accepted_at: null };
    fakeDatabase.campaignParticipants.push(foreign);

    await ingestEmail(emailPayload());

    expect(foreign.status).toBe("active");
  });
});

describe("persistImportedEmails — historical backfill", () => {
  function importedEmail(overrides: Partial<UnipileEmail> = {}): UnipileEmail {
    return {
      id: "unipile-email-hist-1",
      date: "2026-01-05T09:00:00.000Z",
      thread_id: "thread-hist",
      message_id: "<hist-1@mail.example>",
      subject: "Ancien échange",
      body_plain: "Bonjour, je reviens vers vous.",
      role: "inbox",
      from_attendee: { display_name: "Marc Durand", identifier: "marc.durand@example.com" },
      ...overrides,
    };
  }

  it("imports history and marks every message imported=true", async () => {
    const connectionId = seedEmailConnection();

    const result = await persistImportedEmails(workspaceId, connectionId, [importedEmail()]);

    expect(result.messagesInserted).toBe(1);
    expect(fakeDatabase.messages[0]!.metadata).toMatchObject({ imported: true });
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("thread-hist");
  });

  it("never triggers reply-stop for imported history — a backfill is not a live reply", async () => {
    const connectionId = seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "marc.durand@example.com" });
    const participant = seedCampaignParticipant("email", "contact-1");

    await persistImportedEmails(workspaceId, connectionId, [importedEmail()]);

    expect(fakeDatabase.messages).toHaveLength(1);
    expect(participant.status).toBe("active");
  });

  it("is idempotent across repeated imports of the same mail", async () => {
    const connectionId = seedEmailConnection();

    await persistImportedEmails(workspaceId, connectionId, [importedEmail()]);
    const second = await persistImportedEmails(workspaceId, connectionId, [importedEmail()]);

    expect(second.messagesInserted).toBe(0);
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("treats role='sent' as outbound and everything else as inbound", async () => {
    const connectionId = seedEmailConnection();

    await persistImportedEmails(workspaceId, connectionId, [
      importedEmail({ id: "hist-in", role: "inbox" }),
      importedEmail({ id: "hist-out", role: "sent", thread_id: "thread-out", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "marc.durand@example.com" }] }),
    ]);

    expect(fakeDatabase.messages.find((m) => m.provider_message_id === "hist-in")!.direction).toBe("inbound");
    expect(fakeDatabase.messages.find((m) => m.provider_message_id === "hist-out")!.direction).toBe("outbound");
  });
});

describe("toPlainTextBody", () => {
  it("prefers body_plain when the provider supplies it", () => {
    expect(toPlainTextBody({ body_plain: "texte brut", body: "<p>html</p>" })).toBe("texte brut");
  });

  it("strips markup, scripts and styles when only HTML is available", () => {
    // A paragraph break survives as a blank line — collapsing it would run
    // separate paragraphs together and change what the mail actually said.
    expect(toPlainTextBody({ body: "<style>a{}</style><p>Bonjour</p><br><p>Marc</p>" })).toBe("Bonjour\n\nMarc");
  });

  it("collapses runaway blank lines instead of preserving provider padding", () => {
    expect(toPlainTextBody({ body: "<p>A</p><br><br><br><br><p>B</p>" })).toBe("A\n\nB");
  });

  it("returns an empty string for an attachment-only mail rather than inventing a placeholder", () => {
    expect(toPlainTextBody({})).toBe("");
  });
});

// The first real Gmail import measured ~1 message/second because the previous
// implementation opened a connection AND a transaction per email. These tests
// pin the batched shape structurally — no benchmark, just round-trip counts.
describe("persistImportedEmails — batching (transactional N+1 removed)", () => {
  function page(count: number, opts: { threads?: number; addresses?: number } = {}) {
    const threads = opts.threads ?? count;
    const addresses = opts.addresses ?? count;
    return Array.from({ length: count }, (_, i) => ({
      id: `hist-${i}`,
      date: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
      thread_id: `thread-${i % threads}`,
      message_id: `<hist-${i}@mail.example>`,
      subject: `Sujet ${i % threads}`,
      body_plain: `Corps ${i}`,
      role: "inbox",
      from_attendee: { display_name: `Contact ${i % addresses}`, identifier: `person${i % addresses}@example.com` },
    })) as unknown as UnipileEmail[];
  }

  it("3. a page of 25 emails costs ONE connection and ONE transaction, not one per email", async () => {
    const connectionId = seedEmailConnection();

    const result = await persistImportedEmails(workspaceId, connectionId, page(25));

    expect(result.messagesInserted).toBe(25);
    expect(fakeDatabase.connectCount).toBe(1);
    expect(fakeDatabase.beginCount).toBe(1);
    expect(fakeDatabase.batchInsertCount).toBe(1); // all 25 rows in a single INSERT
  });

  it("resolves each repeated address and thread once per page rather than per email", async () => {
    const connectionId = seedEmailConnection();

    // 30 emails, but only 3 distinct threads and 3 distinct correspondents.
    const result = await persistImportedEmails(workspaceId, connectionId, page(30, { threads: 3, addresses: 3 }));

    expect(result.messagesInserted).toBe(30);
    expect(result.threadsTouched).toBe(3);
    expect(fakeDatabase.contacts).toHaveLength(3);
    expect(fakeDatabase.conversations).toHaveLength(3);
    expect(fakeDatabase.connectCount).toBe(1);
    expect(fakeDatabase.beginCount).toBe(1);
  });

  it("holds no transaction open across a provider call — the page is already fetched", async () => {
    const connectionId = seedEmailConnection();
    await persistImportedEmails(workspaceId, connectionId, page(5));

    // Every begin was matched by a commit/rollback.
    expect(fakeDatabase.transactionDepth()).toBe(0);
  });

  it("4/5. re-importing the same page stays idempotent and inserts nothing new", async () => {
    const connectionId = seedEmailConnection();
    await persistImportedEmails(workspaceId, connectionId, page(10));

    const second = await persistImportedEmails(workspaceId, connectionId, page(10));

    expect(second.messagesInserted).toBe(0);
    expect(fakeDatabase.messages).toHaveLength(10);
  });

  it("9. persists inbound and outbound correctly within one batched page", async () => {
    const connectionId = seedEmailConnection();
    const mixed = [
      { id: "in-1", date: "2026-02-01T09:00:00.000Z", thread_id: "t-1", subject: "Devis", body_plain: "Reçu", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
      { id: "out-1", date: "2026-02-01T10:00:00.000Z", thread_id: "t-1", body_plain: "Envoyé", role: "sent", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "marc@example.com" }] },
    ] as unknown as UnipileEmail[];

    await persistImportedEmails(workspaceId, connectionId, mixed);

    const inbound = fakeDatabase.messages.find((m) => m.provider_message_id === "in-1")!;
    const outbound = fakeDatabase.messages.find((m) => m.provider_message_id === "out-1")!;
    expect(inbound.direction).toBe("inbound");
    expect(inbound.status).toBe("received");
    expect(inbound.sender_contact_id).not.toBeNull();
    expect(outbound.direction).toBe("outbound");
    expect(outbound.status).toBe("sent");
    expect(outbound.sender_contact_id).toBeNull();
    // 10. Same thread + same counterparty -> one reconciled Conversation.
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.contacts).toHaveLength(1);
  });

  it("advances last_message_at to the newest message of the page, once", async () => {
    const connectionId = seedEmailConnection();
    const emails = [
      { id: "a", date: "2026-03-01T08:00:00.000Z", thread_id: "t-1", body_plain: "1", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
      { id: "b", date: "2026-03-05T08:00:00.000Z", thread_id: "t-1", body_plain: "2", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
    ] as unknown as UnipileEmail[];

    await persistImportedEmails(workspaceId, connectionId, emails);

    expect(fakeDatabase.conversations[0]!.last_message_at).toBe("2026-03-05T08:00:00.000Z");
  });

  it("keeps the original subject when a later message in the page is a reply", async () => {
    const connectionId = seedEmailConnection();
    const emails = [
      { id: "a", date: "2026-03-01T08:00:00.000Z", thread_id: "t-1", subject: "Votre devis", body_plain: "1", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
      { id: "b", date: "2026-03-02T08:00:00.000Z", thread_id: "t-1", subject: "Re: Votre devis", body_plain: "2", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
    ] as unknown as UnipileEmail[];

    await persistImportedEmails(workspaceId, connectionId, emails);

    expect(fakeDatabase.conversations[0]!.subject).toBe("Votre devis");
  });

  it("skips an unusable email without failing the rest of the page", async () => {
    const connectionId = seedEmailConnection();
    const emails = [
      { id: "ok-1", date: "2026-03-01T08:00:00.000Z", thread_id: "t-1", body_plain: "ok", role: "inbox", from_attendee: { identifier: "marc@example.com" } },
      { id: "bad-1", date: "2026-03-01T09:00:00.000Z", thread_id: "t-2", body_plain: "no counterparty", role: "inbox" },
    ] as unknown as UnipileEmail[];

    const result = await persistImportedEmails(workspaceId, connectionId, emails);

    expect(result.messagesInserted).toBe(1);
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("6/7. a batched historical import triggers no reply-stop and no Activity", async () => {
    const connectionId = seedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-1", workspace_id: workspaceId, display_name: "Marc" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-1", channel_type: "email", identifier_normalized: "person0@example.com" });
    const participant = seedCampaignParticipant("email", "contact-1");

    await persistImportedEmails(workspaceId, connectionId, page(12, { threads: 2, addresses: 1 }));

    expect(participant.status).toBe("active");
    expect(fakeDatabase.activities).toHaveLength(0);
    expect(dispatchCommittedActivityMock).not.toHaveBeenCalled();
  });

  it("8. workspace isolation — every batched row carries the importing workspace", async () => {
    const connectionId = seedEmailConnection();

    await persistImportedEmails(workspaceId, connectionId, page(6, { threads: 2, addresses: 2 }));

    expect(fakeDatabase.messages.every((m) => m.workspace_id === workspaceId)).toBe(true);
    expect(fakeDatabase.conversations.every((c) => c.workspace_id === workspaceId)).toBe(true);
    expect(fakeDatabase.contactIdentities.every((i) => i.workspace_id === workspaceId)).toBe(true);
  });
});

// --- First touch: a real mail to a known address with no thread yet ---
// The capability DECISIONS.md deferred, and the one structural hole that made
// "Email is a real campaign channel" untrue: the shared executor required an
// existing Conversation, so a Contact with a perfectly valid address but no
// thread could only ever end as NOT_ELIGIBLE.

function seedEmailContact(address = "prospect@example.com", contactId = "contact-ft") {
  fakeDatabase.contacts.push({ id: contactId, workspace_id: workspaceId, display_name: "Marc Durand" });
  fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: contactId, channel_type: "email", identifier: address, identifier_normalized: address.toLowerCase() });
  return contactId;
}
function seedConnectedEmailConnection(externalAccountId = accountId) {
  fakeDatabase.connections.push({ id: `conn-${externalAccountId}`, workspace_id: workspaceId, provider: "unipile", channel_type: "email", external_account_id: externalAccountId, status: "connected" });
  return `conn-${externalAccountId}`;
}

describe("sendFirstTouchEmail — sending", () => {
  it("sends to the address resolved from Talvia's own identity, with a real subject and no reply_to", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Suite à notre échange", body: "Bonjour Marc,", idempotencyKey: "part-1:step-1" });

    expect(result.ok).toBe(true);
    const call = sendEmailMock.mock.calls[0]![1];
    expect(call.to).toEqual([{ identifier: "prospect@example.com", display_name: "Marc Durand" }]);
    expect(call.subject).toBe("Suite à notre échange");
    // A first touch has no parent mail — inventing a reply_to would be
    // inventing a provider identifier.
    expect(call.replyTo).toBeUndefined();
    expect(call.idempotencyKey).toBe("part-1:step-1");
  });

  it("creates a Conversation with NO thread id yet — never the message id parked in the thread column", async () => {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Suite à notre échange", body: "Bonjour Marc," });

    const conversation = fakeDatabase.conversations.find((c) => c.connection_id === connectionId)!;
    // NULL means exactly "the provider has not told us the thread yet".
    // Storing the send response's provider_id here instead would file a
    // MESSAGE identifier in the column whose unique(connection_id,
    // external_thread_id) constraint defines THREAD identity.
    expect(conversation.external_thread_id).toBeNull();
    expect(conversation.contact_id).toBe(contactId);
    expect(conversation.subject).toBe("Suite à notre échange");
    expect(result).toMatchObject({ ok: true, conversationId: conversation.id });

    expect(fakeDatabase.messages).toHaveLength(1);
    const message = fakeDatabase.messages[0]!;
    expect(message.direction).toBe("outbound");
    expect(message.provider_message_id).toBe("provider-sent-1");
    // Marked provisional, never presented as a resolved thread.
    expect((message.metadata as Record<string, unknown>).threadResolution).toBe("pending_first_touch");
  });

  it("records the same message.sent activity a threaded send records — an Automation must not behave differently per delivery path", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();

    await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(fakeDatabase.activities.some((a) => a.event_type === "message.sent")).toBe(true);
    expect(dispatchCommittedActivityMock).toHaveBeenCalled();
  });

  it("never opens a transaction while the provider call is in flight", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    let depthDuringSend = -1;
    sendEmailMock.mockImplementationOnce(async () => { depthDuringSend = fakeDatabase.transactionDepth(); return { providerId: "provider-sent-1", trackingId: null }; });

    await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(depthDuringSend).toBe(0);
  });
});

describe("sendFirstTouchEmail — refusals (never a send, never a fabricated success)", () => {
  it("refuses with EMAIL_IDENTITY_MISSING when the Contact has no email identity", async () => {
    seedConnectedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-none", workspace_id: workspaceId, display_name: "Sans adresse" });

    const result = await sendFirstTouchEmail({ workspaceId, contactId: "contact-none", subject: "Objet", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_IDENTITY_MISSING" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses when the identity exists in ANOTHER workspace — a contact id is never an authorization boundary", async () => {
    seedConnectedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-other", workspace_id: "ws-other", display_name: "Ailleurs" });
    fakeDatabase.contactIdentities.push({ workspace_id: "ws-other", contact_id: "contact-other", channel_type: "email", identifier: "ailleurs@example.com", identifier_normalized: "ailleurs@example.com" });

    const result = await sendFirstTouchEmail({ workspaceId, contactId: "contact-other", subject: "Objet", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_IDENTITY_MISSING" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses with EMAIL_CONNECTION_UNAVAILABLE when no email account is connected", async () => {
    fakeDatabase.connections.push({ id: "conn-x", workspace_id: workspaceId, provider: "unipile", channel_type: "email", external_account_id: accountId, status: "error" });
    const contactId = seedEmailContact();

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_CONNECTION_UNAVAILABLE" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses with EMAIL_SUBJECT_MISSING rather than inventing a subject", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "   ", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_SUBJECT_MISSING" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports EMAIL_FIRST_TOUCH_SEND_FAILED and writes nothing when the provider ANSWERS and refuses", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    // providerAnswered is what unipile.ts stamps on a real HTTP rejection:
    // the provider spoke, and it did not send anything.
    sendEmailMock.mockRejectedValueOnce(Object.assign(new Error("Unipile send email failed (500)."), { providerAnswered: true }));

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_FIRST_TOUCH_SEND_FAILED" });
    expect(fakeDatabase.conversations).toHaveLength(0);
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("reports EMAIL_SEND_OUTCOME_UNKNOWN when the provider never answered — the one case that can double-send on retry", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    // A timeout / dropped connection carries no providerAnswered marker.
    sendEmailMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(result).toEqual({ ok: false, reason: "EMAIL_SEND_OUTCOME_UNKNOWN" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("reports the send as DONE (never retryable) but flags reconciliation when the provider returns no identifier", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    sendEmailMock.mockResolvedValueOnce({ providerId: null, trackingId: null });

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    // The mail is out. Reporting failure here would make the engine re-send
    // to a real person; no Conversation is fabricated either.
    expect(result).toEqual({ ok: true, conversationId: null, reason: "EMAIL_THREAD_RECONCILIATION_FAILED" });
    expect(fakeDatabase.conversations).toHaveLength(0);
  });
});

describe("first-touch reconciliation — send response + mail_sent webhook produce ONE message", () => {
  async function firstTouchThenWebhook(overrides: Partial<UnipileNewEmailPayload> = {}) {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    await sendFirstTouchEmail({ workspaceId, contactId, subject: "Suite à notre échange", body: "Bonjour Marc," });
    return ingestEmail(emailPayload({
      event: "mail_sent",
      provider_id: "provider-sent-1",
      email_id: "unipile-email-ft",
      message_id: "<rfc-ft@mail.example>",
      subject: "Suite à notre échange",
      from_attendee: { identifier: "moi@talvia.app" },
      to_attendees: [{ identifier: "prospect@example.com" }],
      ...overrides,
    }));
  }

  it("re-keys the provisional Conversation onto the real thread and never inserts a second message", async () => {
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });

    const result = await firstTouchThenWebhook();

    expect(result).toEqual({ status: "duplicate" });
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("real-thread-1");
    const metadata = fakeDatabase.messages[0]!.metadata as Record<string, unknown>;
    expect(metadata.threadResolution).toBe("provider_thread_id");
    // Re-keyed onto the canonical Unipile id, which is what a redelivery and
    // a later historical import both carry.
    expect(fakeDatabase.messages[0]!.provider_message_id).toBe("unipile-email-ft");
  });

  it("is idempotent across a webhook redelivery", async () => {
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });
    await firstTouchThenWebhook();

    const again = await ingestEmail(emailPayload({
      event: "mail_sent", provider_id: "provider-sent-1", email_id: "unipile-email-ft",
      message_id: "<rfc-ft@mail.example>", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "prospect@example.com" }],
    }));

    expect(again).toEqual({ status: "duplicate" });
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.conversations).toHaveLength(1);
  });

  it("converges onto the Conversation that owns the canonical thread instead of leaving two", async () => {
    // A resync paged this thread in before the webhook landed, for a DIFFERENT
    // contact than the first touch, so the first touch could not adopt it.
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    fakeDatabase.contacts.push({ id: "contact-other", workspace_id: workspaceId, display_name: "Autre" });
    fakeDatabase.conversations.push({ id: "conv-existing", workspace_id: workspaceId, connection_id: `conn-${accountId}`, contact_id: "contact-other", channel_type: "email", external_thread_id: "real-thread-1", subject: null, last_message_at: null, status: "open" });
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });
    await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    await ingestEmail(emailPayload({
      event: "mail_sent", provider_id: "provider-sent-1", email_id: "unipile-email-ft",
      message_id: "<rfc-ft@mail.example>", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "prospect@example.com" }],
    }));

    // The message moved into the real thread's Conversation; the emptied
    // provisional one is archived, not left as a second live thread and not
    // deleted.
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.messages[0]!.conversation_id).toBe("conv-existing");
    const provisional = fakeDatabase.conversations.find((c) => c.id !== "conv-existing")!;
    expect(provisional.external_thread_id).toBeNull();
    expect(provisional.status).toBe("archived");
  });

  it("does not swallow a genuinely unrelated outbound mail sent from outside Talvia", async () => {
    seedConnectedEmailConnection();
    seedEmailContact();
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "other-thread" });

    const result = await ingestEmail(emailPayload({
      event: "mail_sent", provider_id: "provider-unrelated", email_id: "unipile-email-other",
      from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "someone@example.com" }],
    }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.messages).toHaveLength(1);
  });
});

// --- Threaded send (the other half of the pair) ---
// A reply must land in the SAME provider thread and keep the thread's own
// subject. The recipient comes from Talvia's stored identity, never from
// anything a caller passed in.

describe("sendEmailForConversation — real email semantics", () => {
  function seedThread(opts: { subject?: string | null; parentProviderId?: string | null } = {}) {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: "thread-1", subject: opts.subject === undefined ? "Votre devis" : opts.subject, last_message_at: null });
    if (opts.parentProviderId !== null) {
      fakeDatabase.messages.push({ id: "msg-parent", workspace_id: workspaceId, conversation_id: "conv-1", direction: "inbound", body: "Bonjour", status: "received", provider_message_id: "unipile-1", date: "2026-02-01T00:00:00.000Z", metadata: { emailProviderId: opts.parentProviderId ?? "parent-provider-1" } });
    }
    return contactId;
  }

  it("threads the reply onto the parent mail and prefixes the subject once", async () => {
    seedThread();

    await sendEmailForConversation(workspaceId, "conv-1", "Bien reçu.", accountId, "part-1:step-1");

    const call = sendEmailMock.mock.calls[0]![1];
    expect(call.replyTo).toBe("parent-provider-1");
    expect(call.subject).toBe("Re: Votre devis");
    expect(call.to).toEqual([{ identifier: "prospect@example.com", display_name: "Marc Durand" }]);
    expect(call.idempotencyKey).toBe("part-1:step-1");
  });

  it("does not stack a second Re: on a subject that already has one", async () => {
    seedThread({ subject: "Re: Votre devis" });

    await sendEmailForConversation(workspaceId, "conv-1", "Bien reçu.", accountId);

    expect(sendEmailMock.mock.calls[0]![1].subject).toBe("Re: Votre devis");
  });

  it("sends without a reply_to when the thread has no parent carrying a provider id", async () => {
    seedThread({ parentProviderId: null });

    await sendEmailForConversation(workspaceId, "conv-1", "Bonjour.", accountId);

    const call = sendEmailMock.mock.calls[0]![1];
    expect(call.replyTo).toBeUndefined();
    // No reply_to means no reply — the original subject stands as it is.
    expect(call.subject).toBe("Votre devis");
  });

  it("refuses rather than guessing when the Contact has no known address", async () => {
    const connectionId = seedConnectedEmailConnection();
    fakeDatabase.contacts.push({ id: "contact-noaddr", workspace_id: workspaceId, display_name: "Sans adresse" });
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: connectionId, contact_id: "contact-noaddr", channel_type: "email", external_thread_id: "thread-1", subject: "Sujet", last_message_at: null });

    await expect(sendEmailForConversation(workspaceId, "conv-1", "Texte", accountId)).rejects.toThrow(/adresse e-mail/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("never resolves a conversation belonging to another workspace", async () => {
    seedThread();

    await expect(sendEmailForConversation("ws-other", "conv-1", "Texte", accountId)).rejects.toThrow();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

// --- Arrival-order safety ---
// One real outbound email must produce ONE Conversation and ONE message row
// whatever the order of (send response, mail_sent webhook, historical import).
// The send response and the webhook carry DIFFERENT ids for the same mail
// (provider_id vs email_id), so the unique (conversation_id,
// provider_message_id) index cannot relate them on its own — the cross-path
// key is metadata.emailProviderId, which all three paths write.

describe("outbound arrival order — one mail, one Conversation, one message", () => {
  const sentWebhook = (overrides: Partial<UnipileNewEmailPayload> = {}) => emailPayload({
    event: "mail_sent", provider_id: "provider-sent-1", email_id: "unipile-email-ft",
    message_id: "<rfc-ft@mail.example>", subject: "Suite à notre échange",
    from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "prospect@example.com" }],
    ...overrides,
  });

  it("webhook FIRST, then the send response is persisted — the first touch adopts what is there", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });

    // The provider fired mail_sent before sendFirstTouchEmail's own
    // transaction ran — a separate inbound HTTP request racing it.
    await ingestEmail(sentWebhook());
    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Suite à notre échange", body: "Bonjour Marc," });

    expect(result.ok).toBe(true);
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("real-thread-1");
    if (!result.ok) throw new Error("unreachable");
    expect(result.conversationId).toBe(fakeDatabase.conversations[0]!.id);
  });

  it("send response FIRST, then the webhook — the provisional Conversation gets the real thread", async () => {
    seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });

    await sendFirstTouchEmail({ workspaceId, contactId, subject: "Suite à notre échange", body: "Bonjour Marc," });
    await ingestEmail(sentWebhook());

    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.conversations[0]!.external_thread_id).toBe("real-thread-1");
  });

  it("a first touch adopts the Contact's existing email Conversation rather than opening a second", async () => {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    // An inbound mail arrived between audience selection and execution.
    fakeDatabase.conversations.push({ id: "conv-inbound", workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: "thread-inbound", subject: "Bonjour", last_message_at: null, status: "open" });

    const result = await sendFirstTouchEmail({ workspaceId, contactId, subject: "Objet", body: "Corps" });

    expect(result).toMatchObject({ ok: true, conversationId: "conv-inbound" });
    expect(fakeDatabase.conversations).toHaveLength(1);
  });

  it("a THREADED send is reconciled too — this is where a duplicate used to appear", async () => {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    // Exactly what unipile-adapter.ts's sendMessage leaves behind for an
    // email reply: a real thread, and a message keyed on the send response's
    // provider_id — NOT the email_id the webhook will carry.
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: "real-thread-1", subject: "Votre devis", last_message_at: null, status: "open" });
    fakeDatabase.messages.push({ id: "msg-sent", workspace_id: workspaceId, conversation_id: "conv-1", direction: "outbound", body: "Bien reçu.", status: "sent", provider_message_id: "provider-sent-1", date: "2026-03-01T10:00:00.000Z", metadata: { emailProviderId: "provider-sent-1" } });
    getEmailByMessageIdMock.mockResolvedValue({ thread_id: "real-thread-1" });
    dispatchCommittedActivityMock.mockClear();

    const result = await ingestEmail(sentWebhook());

    expect(result).toEqual({ status: "duplicate" });
    expect(fakeDatabase.messages).toHaveLength(1);
    // Re-keyed onto the canonical id, so a redelivery and a later re-import
    // both collapse onto this row.
    expect(fakeDatabase.messages[0]!.provider_message_id).toBe("unipile-email-ft");
    // And crucially: no second message.sent activity for one real email.
    expect(fakeDatabase.activities.filter((a) => a.event_type === "message.sent")).toHaveLength(0);
  });
});

describe("historical import vs a Talvia send", () => {
  it("skips a mail Talvia already mirrored under the send response's own id", async () => {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: null, subject: "Objet", last_message_at: null, status: "open" });
    fakeDatabase.messages.push({ id: "msg-sent", workspace_id: workspaceId, conversation_id: "conv-1", direction: "outbound", body: "Corps", status: "sent", provider_message_id: "provider-sent-1", date: "2026-03-01T10:00:00.000Z", metadata: { emailProviderId: "provider-sent-1", threadResolution: "pending_first_touch" } });

    const result = await persistImportedEmails(workspaceId, connectionId, [{
      id: "unipile-email-ft", provider_id: "provider-sent-1", thread_id: "real-thread-1",
      role: "sent", date: "2026-03-01T10:00:00.000Z", subject: "Objet",
      from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "prospect@example.com" }],
      body_plain: "Corps",
    } as UnipileEmail]);

    // Without this guard the page inserted a SECOND row for one real email:
    // the import keys on email.id, the send mirrored on provider_id.
    expect(result.messagesInserted).toBe(0);
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("still imports a genuinely unrelated sent mail on the same page", async () => {
    const connectionId = seedConnectedEmailConnection();
    const contactId = seedEmailContact();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: "email", external_thread_id: null, subject: "Objet", last_message_at: null, status: "open" });
    fakeDatabase.messages.push({ id: "msg-sent", workspace_id: workspaceId, conversation_id: "conv-1", direction: "outbound", body: "Corps", status: "sent", provider_message_id: "provider-sent-1", date: "2026-03-01T10:00:00.000Z", metadata: { emailProviderId: "provider-sent-1" } });

    const result = await persistImportedEmails(workspaceId, connectionId, [
      { id: "unipile-email-ft", provider_id: "provider-sent-1", thread_id: "real-thread-1", role: "sent", date: "2026-03-01T10:00:00.000Z", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "prospect@example.com" }], body_plain: "Corps" },
      { id: "unipile-email-other", provider_id: "provider-other", thread_id: "thread-other", role: "sent", date: "2026-03-02T10:00:00.000Z", from_attendee: { identifier: "moi@talvia.app" }, to_attendees: [{ identifier: "autre@example.com" }], body_plain: "Autre" },
    ] as UnipileEmail[]);

    expect(result.messagesInserted).toBe(1);
  });
});
