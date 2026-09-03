import { describe, expect, it } from "vitest";
import { isSyncState, readSyncResponse, type SyncState } from "./sync-state";

const running: SyncState = { status: "running", chatsProcessed: 191, messagesImported: 200, chatsSkippedGroups: 0, chatsFailed: 0, error: null };

describe("readSyncResponse — sync response discrimination", () => {
  it("1. a successful SyncState carrying error:null is NOT treated as a failure", () => {
    // The exact payload the first real Gmail sync was returning while it was
    // importing normally. `"error" in data` was true here, which is what made
    // the UI show "Synchronisation échouée : erreur inconnue."
    const result = readSyncResponse(true, running);

    expect(result).toEqual(running);
    expect(result.status).toBe("running");
    expect(result.messagesImported).toBe(200);
  });

  it("keeps a pending state pending, so the polling effect stays alive", () => {
    const pending: SyncState = { status: "pending", chatsProcessed: 0, messagesImported: 0, chatsSkippedGroups: 0, chatsFailed: 0, error: null };

    expect(readSyncResponse(true, pending).status).toBe("pending");
  });

  it("passes a completed state through untouched", () => {
    const completed: SyncState = { status: "completed", chatsProcessed: 44, messagesImported: 7735, chatsSkippedGroups: 2, chatsFailed: 0, error: null };

    expect(readSyncResponse(true, completed)).toEqual(completed);
  });

  it("passes a genuine server-side failure through with its sanitized reason", () => {
    const failed: SyncState = { status: "failed", chatsProcessed: 3, messagesImported: 10, chatsSkippedGroups: 0, chatsFailed: 1, error: "Appel à Unipile en échec (HTTP 429)." };

    expect(readSyncResponse(true, failed)).toEqual(failed);
  });

  it("2. a real HTTP error response stays failed and surfaces the server's message", () => {
    const result = readSyncResponse(false, { error: "Ce canal n'est pas connecté." });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Ce canal n'est pas connecté.");
  });

  it("falls back to a generic reason when the failure carries no usable message", () => {
    expect(readSyncResponse(false, null).error).toBe("la requête a échoué.");
    expect(readSyncResponse(false, {}).error).toBe("la requête a échoué.");
    expect(readSyncResponse(false, { error: 500 }).error).toBe("la requête a échoué.");
  });

  it("treats a 2xx body that is not a SyncState as a failure rather than rendering garbage", () => {
    expect(readSyncResponse(true, null).status).toBe("failed");
    expect(readSyncResponse(true, "unexpected").status).toBe("failed");
  });

  it("is channel-agnostic — nothing here is specific to Gmail, WhatsApp or LinkedIn", () => {
    // One shared discriminator, so the same fix covers every channel.
    expect(isSyncState(running)).toBe(true);
    expect(isSyncState({ error: "boom" })).toBe(false);
  });
});
