// Shape returned by POST /api/connections/[channel]/sync and embedded in
// GET /api/connections — mirrors ConnectionSyncState in
// app/lib/providers/unipile-adapter.ts.
export type SyncState = {
  status: "pending" | "running" | "completed" | "failed";
  chatsProcessed: number;
  messagesImported: number;
  chatsSkippedGroups: number;
  chatsFailed: number;
  error: string | null;
};

// A sync state ALWAYS carries `error`, set to null when nothing failed — so
// `"error" in data` is true for every successful response and cannot be used
// to detect an error payload. Discriminating on that key made the client
// report a healthy, running sync as "Synchronisation échouée : erreur
// inconnue." on every channel (observed on the first real Gmail sync, whose
// server-side state was status=running, error=null, and which was importing
// normally at the time).
//
// `status` is the field only a real SyncState has, so it is what the two
// shapes are told apart by. The route's own contract backs this up: a
// successful response is always a SyncState, and a failure is always
// `{ error }` with a non-2xx status.
export function isSyncState(value: unknown): value is SyncState {
  return typeof value === "object" && value !== null && typeof (value as SyncState).status === "string";
}

// Single place that turns "what the sync endpoint replied" into the state the
// UI should show. HTTP success + a valid SyncState -> show exactly what the
// server reported. Anything else -> a failed state carrying the real,
// server-sanitized reason when there is one.
export function readSyncResponse(ok: boolean, data: unknown): SyncState {
  if (ok && isSyncState(data)) return data;
  const message = typeof (data as { error?: unknown } | null)?.error === "string"
    ? (data as { error: string }).error
    : "la requête a échoué.";
  return { status: "failed", chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: message };
}
