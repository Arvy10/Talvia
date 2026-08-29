import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "./workspace-context";

// lib/inbox.ts talks to Postgres exclusively through `database.query`. This
// fake reimplements just enough of the real lateral-join queries (see
// migration 005/012) to exercise the pagination/ordering logic that
// actually matters here — same fake-DB-by-SQL-prefix approach as
// unipile-adapter.test.ts.
function createFakeDatabase() {
  const conversations: Array<Record<string, unknown>> = [];
  const participants: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const companies: Array<Record<string, unknown>> = [];
  const memberStates: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];

  function conversationBaseRow(conversationId: string, userId: string) {
    const conversation = conversations.find((c) => c.id === conversationId);
    if (!conversation) return null;
    const participant = participants.find((p) => p.conversation_id === conversationId && p.contact_id);
    const contact = participant ? contacts.find((c) => c.id === participant.contact_id) : undefined;
    const company = contact?.company_id ? companies.find((c) => c.id === contact.company_id) : undefined;
    const state = memberStates.find((s) => s.conversation_id === conversationId && s.user_id === userId);
    return {
      id: conversation.id,
      contact_id: contact?.id ?? null,
      display_name: contact?.display_name ?? null,
      company: company?.name ?? null,
      channel_type: conversation.channel_type,
      subject: conversation.subject ?? null,
      archived_at: conversation.archived_at ?? null,
      last_message_at: conversation.last_message_at ?? null,
      last_read_at: state?.last_read_at ?? null,
    };
  }

  function lastMessageRow(conversationId: string) {
    const own = messages
      .filter((m) => m.conversation_id === conversationId && m.status !== "draft")
      .sort((a, b) => String(a.effective_time).localeCompare(String(b.effective_time)));
    return own.at(-1);
  }

  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("select v.id,p.contact_id,ct.display_name,co.name company,v.channel_type,v.subject,v.archived_at,v.last_message_at,s.last_read_at,lm.id")) {
      const [workspaceId, userId, archivedParam] = params as [string, string, boolean];
      const archived = archivedParam === true || String(archivedParam) === "true";
      const rows = conversations
        .filter((c) => c.workspace_id === workspaceId && Boolean(c.archived_at) === archived)
        .map((c) => {
          const base = conversationBaseRow(c.id as string, userId)!;
          const last = lastMessageRow(c.id as string);
          return {
            ...base,
            last_message_id: last?.id ?? null,
            last_message_body: last?.body ?? null,
            last_message_direction: last?.direction ?? null,
            last_message_status: last?.status ?? null,
            last_message_created_at: last?.effective_time ?? null,
          };
        })
        .sort((a, b) => String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")));
      return { rows };
    }

    if (text.startsWith("select v.id,p.contact_id,ct.display_name,co.name company,v.channel_type,v.subject,v.archived_at,v.last_message_at,s.last_read_at from conversations")) {
      const [workspaceId, userId, conversationId] = params as string[];
      const conversation = conversations.find((c) => c.id === conversationId && c.workspace_id === workspaceId);
      if (!conversation) return { rows: [] };
      return { rows: [conversationBaseRow(conversationId, userId)] };
    }

    if (text.startsWith("select id,body,direction,status,effective_time,metadata from messages where workspace_id=$1 and conversation_id=$2 and effective_time>")) {
      const [workspaceId, conversationId, after] = params as string[];
      const rows = messages
        .filter((m) => m.workspace_id === workspaceId && m.conversation_id === conversationId && String(m.effective_time) > after)
        .sort((a, b) => String(a.effective_time).localeCompare(String(b.effective_time)));
      return { rows };
    }

    if (text.startsWith("select id,body,direction,status,effective_time,metadata from messages")) {
      const [workspaceId, conversationId, limitParam, before] = params as [string, string, number, string | undefined];
      let scoped = messages.filter((m) => m.workspace_id === workspaceId && m.conversation_id === conversationId);
      if (before) scoped = scoped.filter((m) => String(m.effective_time) < before);
      const rows = scoped
        .sort((a, b) => String(b.effective_time).localeCompare(String(a.effective_time)))
        .slice(0, limitParam);
      return { rows };
    }

    if (text.startsWith("select id from conversations where workspace_id=$1 and id=$2")) {
      const [workspaceId, conversationId] = params as string[];
      const found = conversations.find((c) => c.id === conversationId && c.workspace_id === workspaceId);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    throw new Error(`unhandled query in fake database: ${text}`);
  }

  return { query, connect: async () => ({ query, release: () => {} }), conversations, participants, contacts, companies, memberStates, messages };
}

let fakeDatabase = createFakeDatabase();
vi.mock("./database", () => ({ get database() { return fakeDatabase; } }));

const { getConversation, getConversationMessages, getConversationMessagesSince, listConversations, MESSAGE_PAGE_SIZE } = await import("./inbox");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

const context: WorkspaceContext = { authUserId: "auth-1", userId: "user-1", workspaceId: "ws-1", role: "owner" };

function seedConversationWithMessages(conversationId: string, count: number, startHour = 0) {
  fakeDatabase.conversations.push({ id: conversationId, workspace_id: context.workspaceId, channel_type: "linkedin", last_message_at: `2026-01-01T${String(startHour + count - 1).padStart(2, "0")}:00:00.000Z` });
  for (let i = 0; i < count; i += 1) {
    fakeDatabase.messages.push({
      id: `${conversationId}-msg-${i}`,
      workspace_id: context.workspaceId,
      conversation_id: conversationId,
      direction: i % 2 === 0 ? "inbound" : "outbound",
      status: "sent",
      body: `Message ${i}`,
      effective_time: `2026-01-01T${String(startHour + i).padStart(2, "0")}:00:00.000Z`,
      metadata: {},
    });
  }
}

describe("getConversation — pagination and ordering", () => {
  it("returns the most recent MESSAGE_PAGE_SIZE messages, oldest-first for display", async () => {
    seedConversationWithMessages("conv-1", MESSAGE_PAGE_SIZE + 10);
    const result = await getConversation(context, "conv-1");
    expect(result!.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    // Oldest-to-newest, top-to-bottom — the last element is the truly latest message.
    expect(result!.messages[0]!.id).toBe(`conv-1-msg-${10}`);
    expect(result!.messages.at(-1)!.id).toBe(`conv-1-msg-${MESSAGE_PAGE_SIZE + 9}`);
    expect(result!.hasMoreMessages).toBe(true);
  });

  it("reports no more messages once the whole history fits in one page", async () => {
    seedConversationWithMessages("conv-1", 5);
    const result = await getConversation(context, "conv-1");
    expect(result!.messages).toHaveLength(5);
    expect(result!.hasMoreMessages).toBe(false);
  });

  it("returns null for a conversation outside the caller's workspace", async () => {
    seedConversationWithMessages("conv-1", 3);
    const result = await getConversation({ ...context, workspaceId: "other-ws" }, "conv-1");
    expect(result).toBeNull();
  });
});

describe("getConversationMessages — older-history pagination", () => {
  it("pages strictly further back with `before`, without re-returning the same page", async () => {
    seedConversationWithMessages("conv-1", 50);
    const firstPage = await getConversationMessages(context, "conv-1", { limit: 20 });
    expect(firstPage!.messages).toHaveLength(20);
    expect(firstPage!.hasMoreMessages).toBe(true);

    const oldestOfFirstPage = firstPage!.messages[0]!.createdAt;
    const secondPage = await getConversationMessages(context, "conv-1", { limit: 20, before: oldestOfFirstPage });
    expect(secondPage!.messages).toHaveLength(20);
    expect(secondPage!.messages.every((m) => m.createdAt < oldestOfFirstPage)).toBe(true);
    // No overlap between pages.
    const firstIds = new Set(firstPage!.messages.map((m) => m.id));
    expect(secondPage!.messages.some((m) => firstIds.has(m.id))).toBe(false);
  });
});

describe("getConversationMessagesSince — incremental polling", () => {
  it("returns only messages strictly after the given cursor, oldest-first", async () => {
    seedConversationWithMessages("conv-1", 10);
    const messages = await getConversationMessagesSince(context, "conv-1", "2026-01-01T07:00:00.000Z");
    expect(messages!.map((m) => m.id)).toEqual(["conv-1-msg-8", "conv-1-msg-9"]);
  });

  it("returns an empty list, not an error, when nothing new has arrived", async () => {
    seedConversationWithMessages("conv-1", 3);
    const messages = await getConversationMessagesSince(context, "conv-1", "2026-01-01T05:00:00.000Z");
    expect(messages).toEqual([]);
  });
});

describe("listConversations — ordering", () => {
  it("orders threads by last_message_at, most recent first", async () => {
    seedConversationWithMessages("conv-old", 1, 0);
    fakeDatabase.conversations.find((c) => c.id === "conv-old")!.last_message_at = "2026-01-01T00:00:00.000Z";
    seedConversationWithMessages("conv-new", 1, 5);
    fakeDatabase.conversations.find((c) => c.id === "conv-new")!.last_message_at = "2026-01-01T05:00:00.000Z";

    const result = await listConversations(context, false);
    expect(result.map((c) => c.id)).toEqual(["conv-new", "conv-old"]);
  });
});
