import type { ChannelId } from "../../app/state/types";

// Unipile is infrastructure, not Talvia's domain model (ARCHITECTURE.md §3).
// This module is the only place that knows Unipile's request/response shapes;
// everything past unipile-adapter.ts deals in normalized Talvia entities.

export type UnipileProvider = "LINKEDIN" | "WHATSAPP" | "GOOGLE";

export const PROVIDER_BY_CHANNEL: Record<ChannelId, UnipileProvider> = {
  linkedin: "LINKEDIN",
  whatsapp: "WHATSAPP",
  gmail: "GOOGLE",
};

export type UnipileConfig = { apiKey: string; apiUrl: string; webhookSecret: string; appBaseUrl: string };

// Mirrors the database.ts lesson from the production outage: a module that
// throws at import time when a config var is merely unset breaks build-time
// page-data collection. Callers check for null and fail per-request instead.
export function getUnipileConfig(): UnipileConfig | null {
  const apiKey = process.env.UNIPILE_API_KEY;
  const apiUrl = process.env.UNIPILE_API_URL;
  const webhookSecret = process.env.UNIPILE_WEBHOOK_SECRET;
  const appBaseUrl = process.env.BETTER_AUTH_URL;
  if (!apiKey || !apiUrl || !webhookSecret || !appBaseUrl) return null;
  return { apiKey, apiUrl, webhookSecret, appBaseUrl };
}

export type HostedAuthLinkParams = { channel: ChannelId; workspaceId: string };

// https://developer.unipile.com/reference/hostedcontroller_requestlink
export async function createHostedAuthLink(config: UnipileConfig, params: HostedAuthLinkParams): Promise<string> {
  const response = await fetch(`${config.apiUrl}/api/v1/hosted/accounts/link`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": config.apiKey },
    body: JSON.stringify({
      type: "create",
      providers: [PROVIDER_BY_CHANNEL[params.channel]],
      api_url: config.apiUrl,
      expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      success_redirect_url: `${config.appBaseUrl}/app/connections?status=success`,
      failure_redirect_url: `${config.appBaseUrl}/app/connections?status=failure`,
      notify_url: `${config.appBaseUrl}/api/webhooks/unipile`,
      // The hosted-auth notify webhook echoes `name` back but — per the
      // documented payload — carries no account_type field of its own, so we
      // pack the channel in ourselves rather than guess at an undocumented one.
      name: `${params.workspaceId}::${params.channel}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unipile hosted auth link request failed (${response.status}).`);
  const data = await response.json() as { object: string; url: string };
  return data.url;
}

// https://developer.unipile.com/docs/hosted-auth — delivered once, to notify_url,
// right after the user finishes the hosted auth wizard. `name` echoes the
// workspaceId we passed when creating the link, which is how we learn which
// workspace this brand-new account_id belongs to.
export type UnipileHostedAuthNotifyPayload = { status: string; account_id: string; name: string };

// https://developer.unipile.com/docs/account-lifecycle — delivered to any
// persistent "account" webhook subscription for accounts already connected.
// No `name` field: the connection must already exist, looked up by account_id.
export type UnipileAccountStatusPayload = {
  AccountStatus: { account_id: string; account_type: string; message: string };
};

// https://developer.unipile.com/docs/message-payload — same attachment shape
// on both the historical listing and the live webhook. `type` covers plain
// media (img/video/audio/file) and provider-specific share cards
// (linkedin_post/video_meeting/media_share/profile/contact_card); `url` is
// only sometimes present directly (and can expire per url_expires_at), so
// callers should not assume it's always usable without the attachment-proxy
// route falling back to GET /messages/{id}/attachments/{attachmentId}.
export type UnipileAttachment = {
  id: string;
  type: "img" | "video" | "audio" | "file" | "linkedin_post" | "video_meeting" | "media_share" | "profile" | "contact_card";
  unavailable?: boolean;
  file_size?: number;
  mimetype?: string;
  url?: string;
  url_expires_at?: number;
  size?: { width?: number; height?: number };
  duration?: number;
  voice_note?: boolean;
  file_name?: string;
};

// https://developer.unipile.com/docs/new-messages-webhook
export type UnipileNewMessagePayload = {
  account_id: string;
  account_type: string;
  account_info?: { type?: string; feature?: string; user_id?: string };
  event: "message_received" | "message_reaction" | "message_read" | "message_edited" | "message_deleted" | "message_delivered";
  chat_id: string;
  timestamp: string;
  webhook_name?: string;
  message_id: string;
  message?: string;
  attachments?: UnipileAttachment[];
  sender?: { attendee_id: string; attendee_name?: string; attendee_provider_id: string; attendee_profile_url?: string };
  attendees?: Array<{ attendee_id: string; attendee_name?: string; attendee_provider_id: string; attendee_profile_url?: string }>;
};

export type UnipileWebhookPayload = UnipileHostedAuthNotifyPayload | UnipileAccountStatusPayload | UnipileNewMessagePayload;

export function isHostedAuthNotifyPayload(payload: UnipileWebhookPayload): payload is UnipileHostedAuthNotifyPayload {
  return "status" in payload && "name" in payload;
}

export function isAccountStatusPayload(payload: UnipileWebhookPayload): payload is UnipileAccountStatusPayload {
  return "AccountStatus" in payload;
}

const CONNECTED_STATUSES = new Set(["CREATION_SUCCESS", "RECONNECTED", "SYNC_SUCCESS", "OK"]);
const ERROR_STATUSES = new Set(["ERROR", "CREDENTIALS", "STOPPED"]);

export function toConnectionStatus(unipileStatus: string): "connected" | "connecting" | "error" | "disconnected" {
  if (CONNECTED_STATUSES.has(unipileStatus)) return "connected";
  if (ERROR_STATUSES.has(unipileStatus)) return "error";
  if (unipileStatus === "DELETED") return "disconnected";
  return "connecting";
}

// --- Historical sync (GET /chats, /chats/{id}/messages, /chats/{id}/attendees) ---
// Field shapes below are confirmed against Unipile's live API, not just the
// docs (which don't fully specify the message/attendee schema) — verified
// with a real connected LinkedIn account during this integration.

export type UnipileChat = {
  id: string;
  account_id: string;
  account_type: string;
  attendee_provider_id?: string;
  timestamp: string | null;
  archived: number;
};

export type UnipileChatMessage = {
  id: string;
  chat_id: string;
  text: string;
  attachments?: UnipileAttachment[];
  is_sender: 0 | 1;
  sender_id: string;
  timestamp: string;
  deleted: 0 | 1;
};

export type UnipileChatAttendee = {
  id: string;
  provider_id: string;
  name?: string;
  is_self: 0 | 1;
  profile_url?: string;
  picture_url?: string;
  specifics?: { occupation?: string };
};

// Without a timeout, a slow/rate-limited Unipile response leaves the caller
// (e.g. the backfill's sequential chat-by-chat loop) hanging indefinitely
// with no error and no progress — observed during this integration.
async function unipileGet<T>(config: UnipileConfig, path: string): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, { headers: { "X-API-KEY": config.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Unipile GET ${path} failed (${response.status}).`);
  return response.json() as Promise<T>;
}

// https://developer.unipile.com/reference/chatscontroller_listallchats
export async function listChats(config: UnipileConfig, accountId: string, cursor?: string): Promise<{ items: UnipileChat[]; cursor: string | null }> {
  const params = new URLSearchParams({ account_id: accountId, limit: "100" });
  if (cursor) params.set("cursor", cursor);
  const data = await unipileGet<{ items: UnipileChat[]; cursor: string | null }>(config, `/api/v1/chats?${params.toString()}`);
  return { items: data.items, cursor: data.cursor };
}

// https://developer.unipile.com/docs/get-messages — most recent first.
export async function listChatMessages(config: UnipileConfig, chatId: string, cursor?: string): Promise<{ items: UnipileChatMessage[]; cursor: string | null }> {
  const params = new URLSearchParams({ limit: "100" });
  if (cursor) params.set("cursor", cursor);
  const data = await unipileGet<{ items: UnipileChatMessage[]; cursor: string | null }>(config, `/api/v1/chats/${chatId}/messages?${params.toString()}`);
  return { items: data.items, cursor: data.cursor };
}

// https://developer.unipile.com/reference/chatscontroller_listattendees
export async function listChatAttendees(config: UnipileConfig, chatId: string): Promise<UnipileChatAttendee[]> {
  const data = await unipileGet<{ items: UnipileChatAttendee[] }>(config, `/api/v1/chats/${chatId}/attendees`);
  return data.items;
}

// https://developer.unipile.com/reference/chatscontroller_sendmessageinchat — this is
// the one call in this module that has a real, irreversible side effect on
// LinkedIn (a real person receives a real message), unlike every read-only
// call above.
export async function sendChatMessage(config: UnipileConfig, chatId: string, text: string): Promise<string | null> {
  const form = new FormData();
  form.set("text", text);
  const response = await fetch(`${config.apiUrl}/api/v1/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "X-API-KEY": config.apiKey, accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unipile send message failed (${response.status}).`);
  const data = await response.json() as { object: string; message_id: string | null };
  return data.message_id;
}

// https://developer.unipile.com/reference/messagescontroller_patchmessage — per
// Unipile's docs, edits are provider-limited: LinkedIn Classic accepts them up
// to 60 minutes after sending, WhatsApp up to ~15. Past that window the
// provider itself rejects it; we surface whatever error Unipile returns.
export async function editChatMessage(config: UnipileConfig, messageId: string, text: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/messages/${messageId}`, {
    method: "PATCH",
    headers: { "X-API-KEY": config.apiKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unipile edit message failed (${response.status}).`);
}

// https://developer.unipile.com/reference/messagescontroller_getattachment —
// binary passthrough. Never expose UNIPILE_API_KEY to the browser, so the
// frontend never talks to Unipile directly for media; this is proxied
// through our own attachment route instead (see api/inbox/attachments).
export async function getMessageAttachment(config: UnipileConfig, messageId: string, attachmentId: string): Promise<{ body: ArrayBuffer; contentType: string | null }> {
  const response = await fetch(`${config.apiUrl}/api/v1/messages/${messageId}/attachments/${attachmentId}`, {
    headers: { "X-API-KEY": config.apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unipile get attachment failed (${response.status}).`);
  return { body: await response.arrayBuffer(), contentType: response.headers.get("content-type") };
}
