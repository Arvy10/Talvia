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
  // Proves no provider fetch is ever held inside an open transaction.
  const transactionDepth = () => openTransactions;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "begin") { openTransactions += 1; return { rows: [] }; }
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

    if (text.startsWith("insert into messages(")) {
      const [workspaceId, conversationId, direction, senderContactId, body, status, providerMessageId, date, metadataJson] = params as string[];
      const duplicate = messages.find((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId);
      if (duplicate) return { rows: [] }; // mirrors ON CONFLICT DO NOTHING
      const row = { id: nextId("msg"), workspace_id: workspaceId, conversation_id: conversationId, direction, sender_contact_id: senderContactId, body, status, provider_message_id: providerMessageId, date, metadata: metadataJson ? JSON.parse(metadataJson) : {} };
      messages.push(row);
      return { rows: [{ id: row.id }] };
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
    connect: async () => ({ query, release: () => {} }),
    connections, contacts, contactIdentities, conversations, conversationParticipants, messages, campaigns, campaignParticipants, activities,
    transactionDepth,
  };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

// The provider lookup that resolves a webhook's thread — a real network call,
// mocked so these tests exercise the ingestion logic, not Unipile.
const getEmailByMessageIdMock = vi.hoisted(() => vi.fn(async () => null as { thread_id?: string } | null));
vi.mock("./unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  getEmailByMessageId: getEmailByMessageIdMock,
}));

const dispatchCommittedActivityMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../activities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../activities")>()),
  dispatchCommittedActivity: dispatchCommittedActivityMock,
}));

const { ingestEmail, persistImportedEmails, toPlainTextBody } = await import("./unipile-email");

beforeEach(() => {
  fakeDatabase = createFakeDatabase();
  getEmailByMessageIdMock.mockReset().mockResolvedValue({ thread_id: "thread-1" });
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
