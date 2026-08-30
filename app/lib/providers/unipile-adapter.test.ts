import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnipileAccountStatusPayload, UnipileHostedAuthNotifyPayload, UnipileNewMessagePayload } from "./unipile";

// unipile-adapter.ts talks to Postgres exclusively through `database.query` /
// `database.connect`. This fake understands only the handful of query shapes
// the adapter actually issues, matched by SQL prefix — same approach as
// business-context-service.test.ts.
function createFakeDatabase() {
  const connections: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const contactIdentities: Array<Record<string, unknown>> = [];
  const conversations: Array<Record<string, unknown>> = [];
  const participants: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const campaigns: Array<Record<string, unknown>> = [];
  const campaignSteps: Array<Record<string, unknown>> = [];
  const campaignParticipants: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };

    if (text.startsWith("insert into connections")) {
      const [workspaceId, provider, channelType, externalAccountId, displayName, status] = params as string[];
      let row = connections.find((c) => c.workspace_id === workspaceId && c.provider === provider && c.external_account_id === externalAccountId);
      if (row) { row.status = status; }
      else { row = { id: nextId("conn"), workspace_id: workspaceId, provider, channel_type: channelType, external_account_id: externalAccountId, display_name: displayName, status }; connections.push(row); }
      return { rows: [row] };
    }

    if (text.startsWith("update connections set status")) {
      const [status, provider, externalAccountId] = params as string[];
      const row = connections.find((c) => c.provider === provider && c.external_account_id === externalAccountId);
      if (row) row.status = status;
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("select id,workspace_id,channel_type from connections")) {
      const [provider, externalAccountId] = params as string[];
      const row = connections.find((c) => c.provider === provider && c.external_account_id === externalAccountId);
      return { rows: row ? [{ id: row.id, workspace_id: row.workspace_id, channel_type: row.channel_type }] : [] };
    }

    if (text.startsWith("select contact_id from contact_identities")) {
      const [workspaceId, identifierNormalized, channelType] = params as string[];
      const row = contactIdentities.find((c) => c.workspace_id === workspaceId && c.channel_type === channelType && c.identifier_normalized === identifierNormalized);
      return { rows: row ? [{ contact_id: row.contact_id }] : [] };
    }

    if (text.startsWith("insert into contacts")) {
      const [workspaceId, firstName, lastName, displayName, jobTitle] = params as string[];
      const row = { id: nextId("contact"), workspace_id: workspaceId, first_name: firstName, last_name: lastName, display_name: displayName, job_title: jobTitle ?? null };
      contacts.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("update contacts set job_title")) {
      const [contactId, jobTitle] = params as string[];
      const row = contacts.find((c) => c.id === contactId);
      if (row && (!row.job_title || row.job_title === "")) row.job_title = jobTitle;
      return { rows: [] };
    }

    if (text.startsWith("insert into contact_identities")) {
      const [workspaceId, contactId, provider, identifier, identifierNormalized, profileUrl, , channelType] = params as string[];
      if (!contactIdentities.some((c) => c.workspace_id === workspaceId && c.channel_type === channelType && c.identifier_normalized === identifierNormalized)) {
        contactIdentities.push({ workspace_id: workspaceId, contact_id: contactId, channel_type: channelType, provider, identifier, identifier_normalized: identifierNormalized, profile_url: profileUrl });
      }
      return { rows: [] };
    }

    if (text.startsWith("select id,contact_id from conversations")) {
      const [connectionId, externalThreadId] = params as string[];
      const row = conversations.find((c) => c.connection_id === connectionId && c.external_thread_id === externalThreadId);
      return { rows: row ? [{ id: row.id, contact_id: row.contact_id }] : [] };
    }

    if (text.startsWith("update conversations set contact_id")) {
      const [conversationId, contactId] = params as string[];
      const row = conversations.find((c) => c.id === conversationId);
      if (row) row.contact_id = contactId;
      return { rows: [] };
    }

    if (text.startsWith("insert into conversations")) {
      const [workspaceId, connectionId, contactId, channelType, externalThreadId] = params as string[];
      const row = { id: nextId("conv"), workspace_id: workspaceId, connection_id: connectionId, contact_id: contactId, channel_type: channelType, external_thread_id: externalThreadId, last_message_at: null as string | null };
      conversations.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("insert into conversation_participants")) {
      const [conversationId, contactId, externalParticipantId] = params as string[];
      if (!participants.some((p) => p.conversation_id === conversationId && p.external_participant_id === externalParticipantId)) {
        participants.push({ conversation_id: conversationId, contact_id: contactId, external_participant_id: externalParticipantId });
      }
      return { rows: [] };
    }

    if (text.startsWith("delete from conversation_participants")) {
      const [conversationId, contactId] = params as string[];
      for (let i = participants.length - 1; i >= 0; i -= 1) {
        if (participants[i]!.conversation_id === conversationId && participants[i]!.contact_id === contactId) participants.splice(i, 1);
      }
      return { rows: [] };
    }

    if (text.startsWith("update conversations set last_message_at")) {
      const [conversationId] = params as string[];
      const row = conversations.find((c) => c.id === conversationId);
      if (row) row.last_message_at = new Date().toISOString();
      return { rows: [] };
    }

    if (text.startsWith("insert into messages(workspace_id,conversation_id,direction,body,status,provider_message_id,sent_at)")) {
      const [workspaceId, conversationId, body, providerMessageId] = params as string[];
      const existing = messages.find((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId);
      if (existing) { existing.status = "sent"; return { rows: [{ id: existing.id, created_at: existing.created_at }] }; }
      const row = { id: nextId("msg"), workspace_id: workspaceId, conversation_id: conversationId, direction: "outbound", sender_contact_id: null, body, status: "sent", provider_message_id: providerMessageId, created_at: new Date().toISOString() };
      messages.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }

    if (text.startsWith("insert into messages")) {
      const [workspaceId, conversationId, direction, senderContactId, body, status, providerMessageId, metadataJson] = params as string[];
      if (messages.some((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId)) {
        return { rows: [] }; // on conflict do nothing
      }
      const row = { id: nextId("msg"), workspace_id: workspaceId, conversation_id: conversationId, direction, sender_contact_id: senderContactId, body, status, provider_message_id: providerMessageId, metadata: metadataJson ? JSON.parse(metadataJson) : {} };
      messages.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("insert into activities")) {
      const [workspaceId, eventType, entityType, entityId] = params as string[];
      const row = { id: nextId("activity"), workspace_id: workspaceId, event_type: eventType, entity_type: entityType, entity_id: entityId, created_at: new Date().toISOString() };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }

    if (text.startsWith("update messages m set status=")) {
      const [status, provider, accountId, externalThreadId, providerMessageId] = params as string[];
      const connection = connections.find((c) => c.provider === provider && c.external_account_id === accountId);
      const conversation = connection ? conversations.find((c) => c.connection_id === connection.id && c.external_thread_id === externalThreadId) : undefined;
      const message = conversation ? messages.find((m) => m.conversation_id === conversation.id && m.provider_message_id === providerMessageId && m.status !== "read") : undefined;
      if (!message) return { rows: [] };
      message.status = status;
      return { rows: [{ id: message.id }] };
    }

    if (text.startsWith("select m.provider_message_id,m.sent_at,m.direction")) {
      const [workspaceId, messageId, provider] = params as string[];
      const message = messages.find((m) => m.id === messageId && m.workspace_id === workspaceId);
      if (!message) return { rows: [] };
      const conversation = conversations.find((c) => c.id === message.conversation_id);
      const connection = conversation ? connections.find((c) => c.id === conversation.connection_id && c.provider === provider) : undefined;
      if (!connection) return { rows: [] };
      return { rows: [{ provider_message_id: message.provider_message_id, sent_at: message.sent_at ?? message.created_at, direction: message.direction }] };
    }

    if (text.startsWith("update messages set body=")) {
      const [body, messageId] = params as string[];
      const row = messages.find((m) => m.id === messageId);
      if (row) { row.body = body; row.edited = true; }
      return { rows: [] };
    }

    if (text.startsWith("select v.external_thread_id,c.external_account_id,c.status")) {
      const [workspaceId, conversationId, provider] = params as string[];
      const conversation = conversations.find((c) => c.id === conversationId && c.workspace_id === workspaceId);
      if (!conversation) return { rows: [] };
      const connection = connections.find((c) => c.id === conversation.connection_id && c.provider === provider);
      if (!connection) return { rows: [] };
      return { rows: [{ external_thread_id: conversation.external_thread_id, external_account_id: connection.external_account_id, status: connection.status }] };
    }

    if (text.startsWith("update campaign_participants set invite_accepted_at=now()")) {
      const [contactId, workspaceId] = params as string[];
      const campaignIds = new Set(campaigns.filter((c) => c.workspace_id === workspaceId).map((c) => c.id));
      const matches = campaignParticipants.filter((p) => p.contact_id === contactId && p.invite_sent_at && !p.invite_accepted_at && campaignIds.has(p.campaign_id));
      for (const p of matches) p.invite_accepted_at = new Date().toISOString();
      return { rows: matches.map((p) => ({ id: p.id, campaign_id: p.campaign_id, current_step_id: p.current_step_id })) };
    }
    if (text.startsWith("update campaign_participants set status='replied'")) {
      const [contactId, workspaceId, excludeIds] = params as [string, string, string[]];
      const campaignIds = new Set(campaigns.filter((c) => c.workspace_id === workspaceId).map((c) => c.id));
      const matches = campaignParticipants.filter((p) => p.contact_id === contactId && (p.status === "active" || p.status === "completed") && p.invite_accepted_at && !p.replied_at && campaignIds.has(p.campaign_id) && !excludeIds.includes(p.id as string));
      for (const p of matches) { p.status = "replied"; p.replied_at = new Date().toISOString(); }
      return { rows: matches.map((p) => ({ id: p.id, campaign_id: p.campaign_id })) };
    }

    // --- step-progression.ts (advanceParticipantToNextStep), exercised for
    // real here — proving the adapter actually advances current_step_id,
    // not just records invite_accepted_at.
    if (text.startsWith("select position from campaign_steps where campaign_id=$1 and id=$2")) {
      const [campaignId, stepId] = params as string[];
      const row = campaignSteps.find((s) => s.campaign_id === campaignId && s.id === stepId);
      return { rows: row ? [{ position: row.position }] : [] };
    }
    if (text.startsWith("select id,position,step_type,message_template from campaign_steps where campaign_id=$1 and position>$2")) {
      const [campaignId, position] = params as [string, number];
      const row = campaignSteps.filter((s) => s.campaign_id === campaignId && (s.position as number) > Number(position)).sort((a, b) => (a.position as number) - (b.position as number))[0];
      return { rows: row ? [{ id: row.id, position: row.position, step_type: row.step_type, message_template: row.message_template ?? null }] : [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=coalesce($1,current_step_id),status='completed'")) {
      const [nextStepId, id] = params as [string | null, string];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) { row.current_step_id = nextStepId ?? row.current_step_id; row.status = "completed"; }
      return { rows: [] };
    }
    if (text.startsWith("update campaign_participants set current_step_id=$1,step_claimed_at=null")) {
      const [nextStepId, id] = params as string[];
      const row = campaignParticipants.find((p) => p.id === id);
      if (row) row.current_step_id = nextStepId;
      return { rows: [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, contacts, contactIdentities, conversations, participants, messages, activities, campaigns, campaignSteps, campaignParticipants };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

// sendMessage's own DB logic is what's under test here — sendChatMessage
// itself is a real network call to Unipile, mocked to isolate that.
const sendChatMessageMock = vi.hoisted(() => vi.fn(async () => "provider-msg-outbound-1"));
const editChatMessageMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./unipile")>()),
  getUnipileConfig: () => ({ apiKey: "test-key", apiUrl: "https://api.test", webhookSecret: "test-secret", appBaseUrl: "https://app.test" }),
  sendChatMessage: sendChatMessageMock,
  editChatMessage: editChatMessageMock,
}));

// ingestMessage only *triggers* the Campaign Engine after an acceptance
// (dynamic import, see unipile-adapter.ts's comment on why) — it must never
// send anything itself. Mocking the engine module lets these tests prove
// exactly that boundary: the adapter delegates, it does not execute.
const runDueCampaignActionsMock = vi.hoisted(() => vi.fn(async () => ({ attempted: 0, sent: 0, skipped: 0, failed: 0 })));
vi.mock("../campaign-execution/engine", () => ({ runDueCampaignActions: runDueCampaignActionsMock }));

const { editMessage, ingestAccountStatus, ingestHostedAuthNotification, ingestMessage, sendMessage } = await import("./unipile-adapter");

beforeEach(() => { fakeDatabase = createFakeDatabase(); sendChatMessageMock.mockClear(); editChatMessageMock.mockClear(); runDueCampaignActionsMock.mockClear(); });

const workspaceId = "ws-1";
const accountId = "acct-unipile-1";

function connectAccount(status = "OK") {
  return ingestHostedAuthNotification({ status, account_id: accountId, name: `${workspaceId}::linkedin` } satisfies UnipileHostedAuthNotifyPayload);
}

const selfUserId = "linkedin-self-divin";

function messagePayload(overrides: Partial<UnipileNewMessagePayload> = {}): UnipileNewMessagePayload {
  return {
    account_id: accountId,
    account_type: "LINKEDIN",
    account_info: { type: "LINKEDIN", user_id: selfUserId },
    event: "message_received",
    chat_id: "chat-1",
    timestamp: new Date().toISOString(),
    message_id: "msg-provider-1",
    message: "Bonjour, intéressé par votre produit.",
    sender: { attendee_id: "att-1", attendee_name: "Jane Doe", attendee_provider_id: "linkedin-jane" },
    ...overrides,
  };
}

describe("ingestHostedAuthNotification", () => {
  it("creates a connection row scoped to the workspace and channel encoded in `name`", async () => {
    await connectAccount("CREATION_SUCCESS");
    expect(fakeDatabase.connections).toHaveLength(1);
    expect(fakeDatabase.connections[0]).toMatchObject({ workspace_id: workspaceId, channel_type: "linkedin", external_account_id: accountId, status: "connected" });
  });

  it("ignores a malformed `name` instead of throwing", async () => {
    await ingestHostedAuthNotification({ status: "OK", account_id: accountId, name: "not-a-valid-name" } satisfies UnipileHostedAuthNotifyPayload);
    expect(fakeDatabase.connections).toHaveLength(0);
  });
});

describe("ingestAccountStatus", () => {
  it("updates an existing connection's status by account_id", async () => {
    await connectAccount("CREATION_SUCCESS");
    await ingestAccountStatus({ account_id: accountId, account_type: "LINKEDIN", message: "ERROR" } satisfies UnipileAccountStatusPayload["AccountStatus"]);
    expect(fakeDatabase.connections[0]!.status).toBe("error");
  });
});

describe("ingestMessage", () => {
  it("returns unknown_account when no connection matches the payload's account_id", async () => {
    const result = await ingestMessage(messagePayload());
    expect(result).toEqual({ status: "unknown_account" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("creates a Contact, Conversation, and Message on the first message from a new sender", async () => {
    await connectAccount();
    const result = await ingestMessage(messagePayload());
    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.contactIdentities).toHaveLength(1);
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("reuses the same Contact and Conversation for a second message from the same sender/thread", async () => {
    await connectAccount();
    await ingestMessage(messagePayload({ message_id: "msg-provider-1" }));
    await ingestMessage(messagePayload({ message_id: "msg-provider-2", message: "Une deuxième question." }));
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.conversations).toHaveLength(1);
    expect(fakeDatabase.messages).toHaveLength(2);
  });

  it("is idempotent: redelivering the same provider_message_id does not duplicate the message", async () => {
    await connectAccount();
    await ingestMessage(messagePayload());
    const redelivered = await ingestMessage(messagePayload());
    expect(redelivered).toEqual({ status: "duplicate" });
    expect(fakeDatabase.messages).toHaveLength(1);
  });

  it("creates a separate Contact for a different sender on the same connection", async () => {
    await connectAccount();
    await ingestMessage(messagePayload());
    await ingestMessage(messagePayload({
      chat_id: "chat-2",
      message_id: "msg-provider-3",
      sender: { attendee_id: "att-2", attendee_name: "John Smith", attendee_provider_id: "linkedin-john" },
    }));
    expect(fakeDatabase.contacts).toHaveLength(2);
    expect(fakeDatabase.conversations).toHaveLength(2);
  });

  it("resolves to an existing Contact already added manually with the same LinkedIn profile, instead of duplicating it", async () => {
    await connectAccount();
    // Mirrors what contacts.ts's replaceIdentities() writes for a manually-entered contact.
    fakeDatabase.contacts.push({ id: "contact-manual", workspace_id: workspaceId, display_name: "Jane Doe" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-manual", channel_type: "linkedin", identifier_normalized: "linkedin.com/in/jane-doe" });

    const result = await ingestMessage(messagePayload({
      sender: { attendee_id: "att-1", attendee_name: "Jane Doe", attendee_provider_id: "linkedin-jane", attendee_profile_url: "https://www.linkedin.com/in/jane-doe/" },
    }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.messages[0]!.sender_contact_id).toBe("contact-manual");
  });

  it("attaches an outbound message to the recipient's Contact, not the workspace's own LinkedIn identity", async () => {
    await connectAccount();
    // Unipile reports `sender` as whoever actually sent it — here, us. The
    // real prospect only shows up in `attendees`.
    const result = await ingestMessage(messagePayload({
      message_id: "msg-provider-outbound-1",
      message: "Merci pour votre message, je vous recontacte rapidement.",
      sender: { attendee_id: "att-self", attendee_name: "Divin Nzabidi", attendee_provider_id: selfUserId },
      attendees: [
        { attendee_id: "att-self", attendee_name: "Divin Nzabidi", attendee_provider_id: selfUserId },
        { attendee_id: "att-1", attendee_name: "Jane Doe", attendee_provider_id: "linkedin-jane", attendee_profile_url: "https://www.linkedin.com/in/jane-doe/" },
      ],
    }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.contacts).toHaveLength(1);
    expect(fakeDatabase.contacts[0]).toMatchObject({ display_name: "Jane Doe" });
    expect(fakeDatabase.messages[0]).toMatchObject({ direction: "outbound", status: "sent", sender_contact_id: null });
  });

  it("returns unknown_account for an outbound message when no other attendee is present", async () => {
    await connectAccount();
    const result = await ingestMessage(messagePayload({
      sender: { attendee_id: "att-self", attendee_name: "Divin Nzabidi", attendee_provider_id: selfUserId },
      attendees: [{ attendee_id: "att-self", attendee_name: "Divin Nzabidi", attendee_provider_id: selfUserId }],
    }));
    expect(result).toEqual({ status: "unknown_account" });
    expect(fakeDatabase.messages).toHaveLength(0);
  });

  it("reconciles a thread that a broken prior delivery pinned to the wrong Contact", async () => {
    await connectAccount();
    // Simulates a conversation a stale/pre-fix ingestion path already
    // created against the workspace's own identity, before this run's
    // correct resolution ever ran against this thread.
    fakeDatabase.contacts.push({ id: "contact-self-bug", workspace_id: workspaceId, display_name: "Divin Nzabidi" });
    fakeDatabase.conversations.push({ id: "conv-poisoned", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-self-bug", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    fakeDatabase.participants.push({ conversation_id: "conv-poisoned", contact_id: "contact-self-bug", external_participant_id: "contact-self-bug" });

    const result = await ingestMessage(messagePayload());

    expect(result).toEqual({ status: "ingested" });
    const conversation = fakeDatabase.conversations.find((c) => c.id === "conv-poisoned");
    expect(conversation!.contact_id).not.toBe("contact-self-bug");
    expect(fakeDatabase.participants.some((p) => p.conversation_id === "conv-poisoned" && p.contact_id === "contact-self-bug")).toBe(false);
    expect(fakeDatabase.contacts.find((c) => c.id === conversation!.contact_id)).toMatchObject({ display_name: "Jane Doe" });
  });
});

describe("sendMessage", () => {
  it("sends via Unipile and stores the message as outbound/sent, keyed by the returned provider message id", async () => {
    await connectAccount();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });

    const result = await sendMessage(workspaceId, "conv-1", "Merci, à bientôt !");

    expect(sendChatMessageMock).toHaveBeenCalledWith(expect.anything(), "chat-1", "Merci, à bientôt !");
    expect(result).toMatchObject({ direction: "outbound", status: "sent", body: "Merci, à bientôt !" });
    expect(fakeDatabase.messages).toHaveLength(1);
    expect(fakeDatabase.messages[0]).toMatchObject({ direction: "outbound", provider_message_id: "provider-msg-outbound-1", sender_contact_id: null });
  });

  it("refuses to send on a conversation with no real provider connection behind it", async () => {
    fakeDatabase.conversations.push({ id: "conv-manual", workspace_id: workspaceId, connection_id: null, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: null, last_message_at: null });
    await expect(sendMessage(workspaceId, "conv-manual", "Bonjour")).rejects.toThrow();
    expect(sendChatMessageMock).not.toHaveBeenCalled();
  });

  it("refuses to send when the connection isn't actually connected", async () => {
    await connectAccount();
    fakeDatabase.connections[0]!.status = "error";
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    await expect(sendMessage(workspaceId, "conv-1", "Bonjour")).rejects.toThrow();
    expect(sendChatMessageMock).not.toHaveBeenCalled();
  });
});

describe("ingestMessage — delivery/read receipts", () => {
  it("marks a sent message delivered, then read, on the matching receipt events", async () => {
    await connectAccount();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    await sendMessage(workspaceId, "conv-1", "Bonjour");
    expect(fakeDatabase.messages[0]!.status).toBe("sent");

    const delivered = await ingestMessage({ ...messagePayload(), event: "message_delivered", chat_id: "chat-1", message_id: "provider-msg-outbound-1" });
    expect(delivered).toEqual({ status: "ingested" });
    expect(fakeDatabase.messages[0]!.status).toBe("delivered");

    const read = await ingestMessage({ ...messagePayload(), event: "message_read", chat_id: "chat-1", message_id: "provider-msg-outbound-1" });
    expect(read).toEqual({ status: "ingested" });
    expect(fakeDatabase.messages[0]!.status).toBe("read");
  });

  it("does not regress a message already marked read back to delivered on a stale redelivery", async () => {
    await connectAccount();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    await sendMessage(workspaceId, "conv-1", "Bonjour");
    await ingestMessage({ ...messagePayload(), event: "message_read", chat_id: "chat-1", message_id: "provider-msg-outbound-1" });

    const stale = await ingestMessage({ ...messagePayload(), event: "message_delivered", chat_id: "chat-1", message_id: "provider-msg-outbound-1" });
    expect(stale).toEqual({ status: "duplicate" });
    expect(fakeDatabase.messages[0]!.status).toBe("read");
  });

  it("is a no-op for a receipt on a message that was never stored", async () => {
    await connectAccount();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    const result = await ingestMessage({ ...messagePayload(), event: "message_read", chat_id: "chat-1", message_id: "never-sent" });
    expect(result).toEqual({ status: "duplicate" });
  });
});

describe("ingestMessage — channel-aware contact identities", () => {
  it("files an incoming WhatsApp message under a whatsapp contact identity, not a hardcoded linkedin one", async () => {
    await ingestHostedAuthNotification({ status: "OK", account_id: "acct-whatsapp-1", name: `${workspaceId}::whatsapp` } satisfies UnipileHostedAuthNotifyPayload);
    const result = await ingestMessage(messagePayload({
      account_id: "acct-whatsapp-1",
      account_info: { type: "WHATSAPP", user_id: selfUserId },
      sender: { attendee_id: "att-wa-1", attendee_name: "Awa Traoré", attendee_provider_id: "33612345678" },
    }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.contactIdentities[0]).toMatchObject({ channel_type: "whatsapp" });
    // Regression: this used to be hardcoded to channel_type='linkedin' and run
    // the LinkedIn URL normalizer against a phone number, since the webhook
    // handler is shared across every provider.
    expect(fakeDatabase.contactIdentities[0]!.channel_type).not.toBe("linkedin");
  });

  it("keeps a LinkedIn message filed under a linkedin contact identity", async () => {
    await connectAccount();
    await ingestMessage(messagePayload());
    expect(fakeDatabase.contactIdentities[0]).toMatchObject({ channel_type: "linkedin" });
  });
});

describe("ingestMessage — attachments", () => {
  it("stores a voice note even though the message has no text", async () => {
    await connectAccount();
    const result = await ingestMessage(messagePayload({
      message: undefined,
      attachments: [{ id: "att-voice-1", type: "audio", mimetype: "audio/ogg", duration: 12, voice_note: true }],
    }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.messages).toHaveLength(1);
    // The mission's explicit failure mode this guards against: a message
    // with no text getting filtered out (`if (!message.text) return null`)
    // as if it were empty, when it actually carries a real attachment.
    expect(fakeDatabase.messages[0]!.body).toBe("");
    expect(fakeDatabase.messages[0]!.metadata).toEqual({ attachments: [{ id: "att-voice-1", type: "audio", mimetype: "audio/ogg", duration: 12, voiceNote: true }] });
  });

  it("stores an image attachment alongside message text", async () => {
    await connectAccount();
    await ingestMessage(messagePayload({
      message: "Regarde cette capture",
      attachments: [{ id: "att-img-1", type: "img", mimetype: "image/png", file_size: 40000, size: { width: 800, height: 600 } }],
    }));

    expect(fakeDatabase.messages[0]!.metadata).toMatchObject({ attachments: [{ id: "att-img-1", type: "img", width: 800, height: 600 }] });
  });

  it("drops an unavailable attachment instead of surfacing a dead reference", async () => {
    await connectAccount();
    await ingestMessage(messagePayload({
      message: "Fichier expiré",
      attachments: [{ id: "att-gone", type: "file", unavailable: true }],
    }));

    expect(fakeDatabase.messages[0]!.metadata).toEqual({});
  });
});

describe("ingestMessage — LinkedIn prospecting acceptance detection", () => {
  it("(B) marks the invite accepted and advances the participant to the message step — never sends anything itself, only triggers the Campaign Engine", async () => {
    await connectAccount();
    fakeDatabase.contacts.push({ id: "contact-jane", workspace_id: workspaceId, display_name: "Jane Doe", first_name: "Jane", last_name: "Doe", company: "Acme Corp" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-jane", channel_type: "linkedin", identifier_normalized: "linkedin-jane" });
    fakeDatabase.campaigns.push({ id: "camp-1", workspace_id: workspaceId, status: "active" });
    fakeDatabase.campaignSteps.push({ id: "step-invite", campaign_id: "camp-1", position: 0, step_type: "invite", message_template: null });
    fakeDatabase.campaignSteps.push({ id: "step-message", campaign_id: "camp-1", position: 1, step_type: "message", message_template: "Bonjour {first_name} !" });
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-jane", status: "active", current_step_id: "step-invite", invite_sent_at: new Date(Date.now() - 60_000).toISOString(), invite_accepted_at: null });

    const result = await ingestMessage(messagePayload());

    expect(result).toEqual({ status: "ingested" });
    // Domain state advanced (current_step_id moved to the message step) —
    // status stays 'active', NOT 'completed': sending — and therefore
    // completing — is the executor's job, not the adapter's.
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "active", current_step_id: "step-message" });
    expect(fakeDatabase.campaignParticipants[0]!.invite_accepted_at).not.toBeNull();
    // The acceptance message itself must never immediately self-stop the
    // participant it just advanced — only a later, genuine reply should.
    expect(fakeDatabase.campaignParticipants[0]!.replied_at).toBeFalsy();
    // No direct provider call from the adapter for the message step.
    expect(sendChatMessageMock).not.toHaveBeenCalled();
    // The Campaign Engine is triggered — scoped to this workspace and
    // campaign — to actually execute the now-due message step.
    expect(runDueCampaignActionsMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), "camp-1");
    expect(fakeDatabase.activities.some((a) => a.event_type === "campaign.invite_accepted")).toBe(true);
  });

  it("does nothing for a contact with no pending prospecting invite", async () => {
    await connectAccount();
    const result = await ingestMessage(messagePayload());
    expect(result).toEqual({ status: "ingested" });
    expect(sendChatMessageMock).not.toHaveBeenCalled();
    expect(runDueCampaignActionsMock).not.toHaveBeenCalled();
  });

  it("(I) a duplicated acceptance webhook (same provider_message_id redelivered) never triggers the engine twice", async () => {
    await connectAccount();
    fakeDatabase.contacts.push({ id: "contact-jane", workspace_id: workspaceId, display_name: "Jane Doe", first_name: "Jane", last_name: "Doe" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-jane", channel_type: "linkedin", identifier_normalized: "linkedin-jane" });
    fakeDatabase.campaigns.push({ id: "camp-1", workspace_id: workspaceId, status: "active" });
    fakeDatabase.campaignSteps.push({ id: "step-invite", campaign_id: "camp-1", position: 0, step_type: "invite", message_template: null });
    fakeDatabase.campaignSteps.push({ id: "step-message", campaign_id: "camp-1", position: 1, step_type: "message", message_template: "Bonjour {first_name} !" });
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-jane", status: "active", current_step_id: "step-invite", invite_sent_at: new Date(Date.now() - 60_000).toISOString(), invite_accepted_at: null });

    const first = await ingestMessage(messagePayload());
    const second = await ingestMessage(messagePayload()); // same message_id -> a redelivered webhook

    expect(first).toEqual({ status: "ingested" });
    expect(second).toEqual({ status: "duplicate" });
    expect(runDueCampaignActionsMock).toHaveBeenCalledTimes(1);
  });

  it("stops the participant's sequence — server-side — the moment a genuine reply arrives after acceptance", async () => {
    await connectAccount();
    fakeDatabase.contacts.push({ id: "contact-jane", workspace_id: workspaceId, display_name: "Jane Doe", first_name: "Jane", last_name: "Doe", company: "Acme Corp" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-jane", channel_type: "linkedin", identifier_normalized: "linkedin-jane" });
    fakeDatabase.campaigns.push({ id: "camp-1", workspace_id: workspaceId });
    fakeDatabase.campaignSteps.push({ id: "step-invite", campaign_id: "camp-1", position: 0, step_type: "invite", message_template: null });
    fakeDatabase.campaignSteps.push({ id: "step-message", campaign_id: "camp-1", position: 1, step_type: "message", message_template: "Bonjour {first_name} !" });
    // Already past acceptance and follow-up (as the previous test proves
    // that transition works) — this is the resting state a real reply
    // arrives into.
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-jane", status: "completed", current_step_id: "step-message", invite_sent_at: new Date(Date.now() - 120_000).toISOString(), invite_accepted_at: new Date(Date.now() - 60_000).toISOString(), replied_at: null });

    const result = await ingestMessage(messagePayload({ message_id: "msg-provider-reply-1", message: "En fait je ne suis pas intéressé, merci." }));

    expect(result).toEqual({ status: "ingested" });
    expect(fakeDatabase.campaignParticipants[0]).toMatchObject({ status: "replied" });
    expect(fakeDatabase.campaignParticipants[0]!.replied_at).not.toBeNull();
    expect(fakeDatabase.activities.some((a) => a.event_type === "campaign.participant_stopped")).toBe(true);
  });

  it("is idempotent — a duplicate reply webhook does not re-stop an already-replied participant", async () => {
    await connectAccount();
    fakeDatabase.contacts.push({ id: "contact-jane", workspace_id: workspaceId, display_name: "Jane Doe", first_name: "Jane", last_name: "Doe" });
    fakeDatabase.contactIdentities.push({ workspace_id: workspaceId, contact_id: "contact-jane", channel_type: "linkedin", identifier_normalized: "linkedin-jane" });
    fakeDatabase.campaigns.push({ id: "camp-1", workspace_id: workspaceId });
    const repliedAt = new Date(Date.now() - 30_000).toISOString();
    fakeDatabase.campaignParticipants.push({ id: "part-1", campaign_id: "camp-1", contact_id: "contact-jane", status: "replied", current_step_id: "step-message", invite_sent_at: new Date(Date.now() - 120_000).toISOString(), invite_accepted_at: new Date(Date.now() - 60_000).toISOString(), replied_at: repliedAt });

    await ingestMessage(messagePayload({ message_id: "msg-provider-reply-2", message: "Un second message." }));

    expect(fakeDatabase.campaignParticipants[0]!.replied_at).toBe(repliedAt);
  });
});

describe("editMessage", () => {
  async function sendAndGetMessageId() {
    await connectAccount();
    fakeDatabase.conversations.push({ id: "conv-1", workspace_id: workspaceId, connection_id: fakeDatabase.connections[0]!.id, contact_id: "contact-1", channel_type: "linkedin", external_thread_id: "chat-1", last_message_at: null });
    const sent = await sendMessage(workspaceId, "conv-1", "Salut frre");
    return sent.id;
  }

  it("edits a recently-sent outbound message via Unipile and updates the local body", async () => {
    const messageId = await sendAndGetMessageId();

    await editMessage(workspaceId, messageId, "Salut frère");

    expect(editChatMessageMock).toHaveBeenCalledWith(expect.anything(), "provider-msg-outbound-1", "Salut frère");
    expect(fakeDatabase.messages[0]!.body).toBe("Salut frère");
  });

  it("refuses to edit a message older than LinkedIn's 60-minute window", async () => {
    const messageId = await sendAndGetMessageId();
    fakeDatabase.messages[0]!.sent_at = new Date(Date.now() - 61 * 60 * 1000).toISOString();

    await expect(editMessage(workspaceId, messageId, "Trop tard")).rejects.toThrow();
    expect(editChatMessageMock).not.toHaveBeenCalled();
  });

  it("refuses to edit an inbound message", async () => {
    await connectAccount();
    await ingestMessage(messagePayload());
    const inboundId = fakeDatabase.messages[0]!.id as string;

    await expect(editMessage(workspaceId, inboundId, "Non merci")).rejects.toThrow();
    expect(editChatMessageMock).not.toHaveBeenCalled();
  });

  it("refuses to edit a message that doesn't belong to the workspace", async () => {
    const messageId = await sendAndGetMessageId();
    await expect(editMessage("other-workspace", messageId, "Nope")).rejects.toThrow();
    expect(editChatMessageMock).not.toHaveBeenCalled();
  });
});
