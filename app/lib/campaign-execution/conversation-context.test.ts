import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake DB by SQL prefix — same convention as campaigns.test.ts /
// step-progression.test.ts. Only conversations+messages are needed here:
// conversation-context.ts's two queries (findConversationId's canonical
// resolution, then the bounded messages fetch) are the entire surface under
// test. queryCount proves the "no N+1" requirement directly — one build call
// must always cost exactly 2 queries, regardless of how many messages exist.
function createFakeDatabase() {
  const conversations: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  let queryCount = 0;

  async function query(sql: string, params: unknown[] = []) {
    queryCount += 1;
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("select id from conversations where workspace_id=$1 and contact_id=$2 and channel_type=$3")) {
      const [workspaceId, contactId, channelType] = params as [string, string, string];
      const rows = conversations
        .filter((c) => c.workspace_id === workspaceId && c.contact_id === contactId && c.channel_type === channelType)
        .slice()
        .sort((a, b) => {
          const aKey = (a.last_message_at as string | null) ?? (a.created_at as string);
          const bKey = (b.last_message_at as string | null) ?? (b.created_at as string);
          if (aKey !== bKey) return aKey < bKey ? 1 : -1;
          if (a.created_at !== b.created_at) return (a.created_at as string) < (b.created_at as string) ? 1 : -1;
          return (a.id as string) < (b.id as string) ? 1 : -1;
        });
      return { rows: rows.length ? [{ id: rows[0]!.id }] : [] };
    }

    if (text.startsWith("select direction, body, effective_time from messages where workspace_id=$1 and conversation_id=$2 and status<>'draft'")) {
      const [workspaceId, conversationId, limit] = params as [string, string, number];
      const rows = messages
        .filter((m) => m.workspace_id === workspaceId && m.conversation_id === conversationId && m.status !== "draft")
        .slice()
        .sort((a, b) => {
          if (a.effective_time !== b.effective_time) return (a.effective_time as string) < (b.effective_time as string) ? 1 : -1;
          return (a.id as string) < (b.id as string) ? 1 : -1;
        })
        .slice(0, limit)
        .map((m) => ({ direction: m.direction, body: m.body, effective_time: m.effective_time }));
      return { rows };
    }

    throw new Error(`Unhandled query in fake DB: ${text}`);
  }

  return { query, conversations, messages, get queryCount() { return queryCount; } };
}

let fakeDatabase = createFakeDatabase();
vi.mock("../database", () => ({ get database() { return fakeDatabase; } }));

const { buildWhatsAppConversationContext, DEFAULT_CONTEXT_MESSAGES, MAX_CONTEXT_MESSAGES } = await import("./conversation-context");
const { findConversationId } = await import("./conversation-resolution");

beforeEach(() => { fakeDatabase = createFakeDatabase(); });

const workspaceId = "ws-1";

function seedConversation(id: string, contactId: string, opts: { workspaceId?: string; lastMessageAt?: string | null; createdAt?: string } = {}) {
  fakeDatabase.conversations.push({
    id, workspace_id: opts.workspaceId ?? workspaceId, contact_id: contactId, channel_type: "whatsapp",
    last_message_at: opts.lastMessageAt ?? null, created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
  });
}

function seedMessage(id: string, conversationId: string, opts: { workspaceId?: string; direction?: "inbound" | "outbound"; body?: string; status?: string; effectiveTime?: string } = {}) {
  fakeDatabase.messages.push({
    id, workspace_id: opts.workspaceId ?? workspaceId, conversation_id: conversationId,
    direction: opts.direction ?? "inbound", body: opts.body ?? "Bonjour", status: opts.status ?? "received",
    effective_time: opts.effectiveTime ?? "2026-01-01T00:00:00.000Z",
  });
}

describe("buildWhatsAppConversationContext — canonical Conversation", () => {
  it("resolves the exact same conversationId as findConversationId", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { effectiveTime: "2026-01-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");
    const resolved = await findConversationId(workspaceId, "contact-1", "whatsapp");

    expect(context?.conversationId).toBe(resolved);
  });

  it("returns null when the Contact has no WhatsApp Conversation at all", async () => {
    const context = await buildWhatsAppConversationContext(workspaceId, "contact-none");
    expect(context).toBeNull();
  });

  it("never returns a Conversation or messages from another workspace", async () => {
    seedConversation("conv-other-ws", "contact-1", { workspaceId: "ws-2" });
    seedMessage("msg-other-ws", "conv-other-ws", { workspaceId: "ws-2" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");
    expect(context).toBeNull();
  });
});

describe("buildWhatsAppConversationContext — message window", () => {
  it("returns an empty context (not null) for a Conversation with zero messages", async () => {
    seedConversation("conv-1", "contact-1", { createdAt: "2026-01-01T00:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context).toEqual({ conversationId: "conv-1", recentMessages: [], lastMessageAt: null, daysSinceLastMessage: null });
  });

  it("returns an empty context when the Conversation has only draft messages", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("draft-1", "conv-1", { status: "draft", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages).toEqual([]);
    expect(context?.lastMessageAt).toBeNull();
    expect(context?.daysSinceLastMessage).toBeNull();
  });

  it("excludes drafts from an otherwise real exchange", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "Le devis m'intéresse", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("draft-1", "conv-1", { direction: "outbound", body: "brouillon non envoyé", status: "draft", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages).toHaveLength(1);
    expect(context?.recentMessages[0]!.body).toBe("Le devis m'intéresse");
  });

  it("returns all messages, oldest to newest, when fewer than the limit exist", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { body: "premier", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-2", "conv-1", { body: "second", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages.map((m) => m.body)).toEqual(["premier", "second"]);
  });

  it("selects the N most recent messages (not the oldest N) and respects the configured limit", async () => {
    seedConversation("conv-1", "contact-1");
    for (let i = 0; i < 15; i += 1) {
      seedMessage(`msg-${i}`, "conv-1", { body: `message-${i}`, effectiveTime: `2026-02-01T${String(i).padStart(2, "0")}:00:00.000Z` });
    }

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1", { limit: 5 });

    expect(context?.recentMessages).toHaveLength(5);
    expect(context?.recentMessages.map((m) => m.body)).toEqual(["message-10", "message-11", "message-12", "message-13", "message-14"]);
  });

  it("orders the returned messages chronologically oldest -> newest regardless of DB fetch order", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-late", "conv-1", { body: "recent", effectiveTime: "2026-02-01T12:00:00.000Z" });
    seedMessage("msg-early", "conv-1", { body: "old", effectiveTime: "2026-02-01T08:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages.map((m) => m.body)).toEqual(["old", "recent"]);
  });

  it("preserves inbound/outbound direction for each message", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { direction: "inbound", body: "question", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-2", "conv-1", { direction: "outbound", body: "réponse", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages).toEqual([
      { direction: "inbound", body: "question", at: "2026-02-01T09:00:00.000Z" },
      { direction: "outbound", body: "réponse", at: "2026-02-01T10:00:00.000Z" },
    ]);
  });

  it("uses effective_time (not insertion order) both for selection and as the returned 'at'", async () => {
    seedConversation("conv-1", "contact-1");
    // Inserted out of chronological order on purpose — effective_time, not
    // array position, must govern what is selected and how it's returned.
    seedMessage("msg-b", "conv-1", { body: "b", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-a", "conv-1", { body: "a", effectiveTime: "2026-01-01T09:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages.map((m) => [m.body, m.at])).toEqual([["a", "2026-01-01T09:00:00.000Z"], ["b", "2026-02-01T09:00:00.000Z"]]);
  });

  it("resolves a tie on effective_time deterministically, and consistently across repeated calls", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-x", "conv-1", { body: "x", effectiveTime: "2026-02-01T09:00:00.000Z" });
    seedMessage("msg-y", "conv-1", { body: "y", effectiveTime: "2026-02-01T09:00:00.000Z" });

    const first = await buildWhatsAppConversationContext(workspaceId, "contact-1");
    const second = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(first?.recentMessages.map((m) => m.body)).toEqual(second?.recentMessages.map((m) => m.body));
    expect(first?.recentMessages).toHaveLength(2);
  });

  it("treats an imported (historical) message identically to a realtime one — no special-casing", async () => {
    seedConversation("conv-1", "contact-1");
    fakeDatabase.messages.push({ id: "msg-imported", workspace_id: workspaceId, conversation_id: "conv-1", direction: "inbound", body: "message importé", status: "received", effective_time: "2026-02-01T09:00:00.000Z", metadata: { imported: true } });
    seedMessage("msg-realtime", "conv-1", { body: "message temps réel", effectiveTime: "2026-02-01T10:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages.map((m) => m.body)).toEqual(["message importé", "message temps réel"]);
  });

  it("passes an empty body through unchanged for an attachment-only message — never a synthesized placeholder", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { body: "", effectiveTime: "2026-02-01T09:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages[0]!.body).toBe("");
  });

  it("clamps a caller-supplied limit above MAX_CONTEXT_MESSAGES down to the hard ceiling", async () => {
    seedConversation("conv-1", "contact-1");
    for (let i = 0; i < MAX_CONTEXT_MESSAGES + 10; i += 1) {
      seedMessage(`msg-${i}`, "conv-1", { effectiveTime: `2026-03-01T${String(i % 24).padStart(2, "0")}:${String(Math.floor(i / 24)).padStart(2, "0")}:00.000Z` });
    }

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1", { limit: 999 });

    expect(context?.recentMessages.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
  });

  it("uses DEFAULT_CONTEXT_MESSAGES when no limit is supplied", async () => {
    seedConversation("conv-1", "contact-1");
    for (let i = 0; i < DEFAULT_CONTEXT_MESSAGES + 5; i += 1) {
      seedMessage(`msg-${i}`, "conv-1", { effectiveTime: `2026-03-01T${String(i % 24).padStart(2, "0")}:${String(Math.floor(i / 24)).padStart(2, "0")}:00.000Z` });
    }

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.recentMessages).toHaveLength(DEFAULT_CONTEXT_MESSAGES);
  });
});

describe("buildWhatsAppConversationContext — daysSinceLastMessage", () => {
  it("computes a deterministic day count from an injected `now`, not the real clock", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { effectiveTime: "2026-02-01T00:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1", { now: new Date("2026-02-06T00:00:00.000Z") });

    expect(context?.lastMessageAt).toBe("2026-02-01T00:00:00.000Z");
    expect(context?.daysSinceLastMessage).toBe(5);
  });

  it("floors a partial day rather than rounding it", async () => {
    seedConversation("conv-1", "contact-1");
    seedMessage("msg-1", "conv-1", { effectiveTime: "2026-02-01T18:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1", { now: new Date("2026-02-02T12:00:00.000Z") });

    expect(context?.daysSinceLastMessage).toBe(0); // 18h elapsed, not a full day
  });

  it("uses the most recent message actually returned as lastMessageAt, not conversations.last_message_at", async () => {
    seedConversation("conv-1", "contact-1", { lastMessageAt: "2099-01-01T00:00:00.000Z" }); // deliberately stale/wrong stored value
    seedMessage("msg-1", "conv-1", { effectiveTime: "2026-02-01T00:00:00.000Z" });

    const context = await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(context?.lastMessageAt).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("buildWhatsAppConversationContext — performance", () => {
  it("issues exactly 2 queries (resolution + bounded fetch) no matter how many messages exist", async () => {
    seedConversation("conv-1", "contact-1");
    for (let i = 0; i < 50; i += 1) {
      seedMessage(`msg-${i}`, "conv-1", { effectiveTime: `2026-04-01T${String(i % 24).padStart(2, "0")}:${String(Math.floor(i / 24)).padStart(2, "0")}:00.000Z` });
    }

    await buildWhatsAppConversationContext(workspaceId, "contact-1");

    expect(fakeDatabase.queryCount).toBe(2);
  });

  it("issues exactly 1 query (resolution only) when there is no eligible Conversation", async () => {
    await buildWhatsAppConversationContext(workspaceId, "contact-none");
    expect(fakeDatabase.queryCount).toBe(1);
  });
});
