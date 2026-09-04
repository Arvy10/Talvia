import { database } from "../database";
import type { CampaignChannel } from "../campaigns";
import { findConversationId } from "./conversation-resolution";

// This builder exposes OBSERVED DATA from a real Conversation, nothing
// inferred or generated. No LLM call happens here — grounded generation is
// campaign-personalization.ts's concern.
//
// Originally WhatsApp-only (C1). Now channel-parameterized, because email
// turned out to have exactly the same evidence shape — a free-form message
// history on an existing thread — and duplicating this file for it would
// have meant two definitions of "what was actually said", which is precisely
// the divergence conversation-resolution.ts exists to prevent. LinkedIn
// stays out: its evidence source is a structured prospect profile, which has
// nothing structurally in common with a message history.

export type ConversationContextMessage = {
  direction: "inbound" | "outbound";
  body: string;
  at: string;
};

export type ConversationContext = {
  conversationId: string;
  recentMessages: ConversationContextMessage[];
  lastMessageAt: string | null;
  daysSinceLastMessage: number | null;
};

// Pre-existing names, kept so no WhatsApp caller or test has to change.
export type WhatsAppConversationContextMessage = ConversationContextMessage;
export type WhatsAppConversationContext = ConversationContext;

// Batch-execution limits (DEFAULT_BATCH_LIMIT/MAX_BATCH_LIMIT in the
// executors) size how many PARTICIPANTS get processed per engine run — an
// unrelated problem to how many MESSAGES belong in one LLM prompt. A relance
// only needs enough of the tail of the exchange to ground what was actually
// said, not the whole batch-processing throughput budget. 12 covers roughly
// six back-and-forth turns, which comfortably spans the last topic discussed
// even with a few scheduling/confirmation messages mixed in; 30 is a hard
// ceiling so a caller can widen the window later (e.g. per campaign
// objective in C2) without ever risking an unbounded prompt or query.
export const DEFAULT_CONTEXT_MESSAGES = 12;
export const MAX_CONTEXT_MESSAGES = 30;

function daysBetween(from: Date, to: Date): number {
  // Both timestamps are timestamptz (UTC internally) round-tripped through
  // ISO strings, so diffing epoch milliseconds is timezone-safe — no
  // calendar-date subtraction that could drift by a day near midnight in a
  // particular zone. Floored, not rounded: "1 day since" should mean a full
  // 24h elapsed, not "yesterday" by wall-clock date.
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// workspaceId+contactId -> canonical whatsapp Conversation (findConversationId,
// never re-resolved here) -> its most recent non-draft messages, fetched
// bounded in SQL (never the full history then sliced in JS), reordered
// chronologically for a future prompt to read naturally. Returns null when
// no eligible Conversation exists at all (Contact has no WhatsApp
// Conversation in this workspace) — a genuinely empty Conversation still
// returns a context, just with an empty recentMessages/null timestamps,
// since "no messages" is itself a real observed fact for C2 to fall back on.
export async function buildChannelConversationContext(
  workspaceId: string,
  contactId: string,
  channel: CampaignChannel,
  opts?: { limit?: number; now?: Date },
): Promise<ConversationContext | null> {
  const conversationId = await findConversationId(workspaceId, contactId, channel);
  if (!conversationId) return null;

  const limit = Math.min(Math.max(Math.trunc(opts?.limit ?? DEFAULT_CONTEXT_MESSAGES), 1), MAX_CONTEXT_MESSAGES);

  // Fetched newest-first with a LIMIT so the DB only ever touches the tail
  // of the conversation (backed by messages_conversation_effective_idx, the
  // same index the Inbox history reads use) — never the whole thread. `id`
  // is a final deterministic tie-break for rows sharing one effective_time
  // (e.g. two messages backfilled in the same batch), mirroring the same
  // tie-break shape used by the canonical Conversation resolution rule.
  // Drafts are excluded (status<>'draft') — a draft is an unsent human
  // intention, never something the prospect or Talvia actually said.
  // metadata.imported gets no special treatment: an imported historical
  // message and a realtime one are the same real exchange once persisted —
  // only side-effect dispatch (automations, campaign triggers) distinguishes
  // them elsewhere, not what a context builder should see as "was said".
  const result = await database.query<{ direction: "inbound" | "outbound"; body: string; effective_time: string }>(
    `select direction, body, effective_time from messages
     where workspace_id=$1 and conversation_id=$2 and status<>'draft'
     order by effective_time desc, id desc
     limit $3`,
    [workspaceId, conversationId, limit],
  );

  // Reversed to oldest -> newest: the DB fetch order (newest-first, for a
  // cheap bounded scan) and the shape a reader should see (a conversation
  // read top to bottom) are different concerns — reordering here keeps the
  // SQL simple and keeps this the only place that cares about display order.
  const recentMessages = result.rows.slice().reverse().map((row) => ({ direction: row.direction, body: row.body, at: row.effective_time }));

  const lastMessageAt = recentMessages.length ? recentMessages[recentMessages.length - 1]!.at : null;
  const now = opts?.now ?? new Date();
  const daysSinceLastMessage = lastMessageAt ? daysBetween(new Date(lastMessageAt), now) : null;

  return { conversationId, recentMessages, lastMessageAt, daysSinceLastMessage };
}

// The WhatsApp entry point, unchanged for every existing caller: exactly the
// builder above with the channel pinned. Kept as its own named function
// rather than making callers pass a literal, so the WhatsApp personalization
// path keeps reading as "the WhatsApp conversation context" and cannot
// accidentally be pointed at another channel by a typo.
export async function buildWhatsAppConversationContext(
  workspaceId: string,
  contactId: string,
  opts?: { limit?: number; now?: Date },
): Promise<WhatsAppConversationContext | null> {
  return buildChannelConversationContext(workspaceId, contactId, "whatsapp", opts);
}
