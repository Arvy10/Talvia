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
      const [workspaceId, identifierNormalized] = params as string[];
      const row = contactIdentities.find((c) => c.workspace_id === workspaceId && c.channel_type === "linkedin" && c.identifier_normalized === identifierNormalized);
      return { rows: row ? [{ contact_id: row.contact_id }] : [] };
    }

    if (text.startsWith("insert into contacts")) {
      const [workspaceId, firstName, lastName, displayName] = params as string[];
      const row = { id: nextId("contact"), workspace_id: workspaceId, first_name: firstName, last_name: lastName, display_name: displayName };
      contacts.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("insert into contact_identities")) {
      const [workspaceId, contactId, provider, identifier, identifierNormalized, profileUrl] = params as string[];
      if (!contactIdentities.some((c) => c.workspace_id === workspaceId && c.channel_type === "linkedin" && c.identifier_normalized === identifierNormalized)) {
        contactIdentities.push({ workspace_id: workspaceId, contact_id: contactId, channel_type: "linkedin", provider, identifier, identifier_normalized: identifierNormalized, profile_url: profileUrl });
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

    if (text.startsWith("insert into messages")) {
      const [workspaceId, conversationId, direction, senderContactId, body, status, providerMessageId] = params as string[];
      if (messages.some((m) => m.conversation_id === conversationId && m.provider_message_id === providerMessageId)) {
        return { rows: [] }; // on conflict do nothing
      }
      const row = { id: nextId("msg"), workspace_id: workspaceId, conversation_id: conversationId, direction, sender_contact_id: senderContactId, body, status, provider_message_id: providerMessageId };
      messages.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("insert into activities")) {
      const [workspaceId, eventType, entityType, entityId] = params as string[];
      const row = { id: nextId("activity"), workspace_id: workspaceId, event_type: eventType, entity_type: entityType, entity_id: entityId, created_at: new Date().toISOString() };
      activities.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), connections, contacts, contactIdentities, conversations, participants, messages, activities };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const { ingestAccountStatus, ingestHostedAuthNotification, ingestMessage } = await import("./unipile-adapter");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

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
