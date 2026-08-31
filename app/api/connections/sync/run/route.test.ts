import { beforeEach, describe, expect, it, vi } from "vitest";

// Same Bearer-secret pattern as api/campaigns/engine/run/route.ts — this
// test only proves the auth gate and that the runner is actually invoked.
// runDueConnectionSyncs' own claim/backfill behavior is tested exhaustively
// in lib/providers/unipile-adapter.test.ts, not re-tested here.
const runDueConnectionSyncsMock = vi.hoisted(() => vi.fn(async () => ({ claimed: 0, completed: 0, failed: 0 })));
vi.mock("../../../../lib/providers/unipile-adapter", () => ({
  runDueConnectionSyncs: runDueConnectionSyncsMock,
}));

const { POST } = await import("./route");

const SECRET = "test-connection-sync-secret";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/connections/sync/run", { method: "POST", headers });
}

describe("POST /api/connections/sync/run", () => {
  beforeEach(() => {
    runDueConnectionSyncsMock.mockClear();
    process.env.CONNECTION_SYNC_SECRET = SECRET;
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(runDueConnectionSyncsMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect Bearer secret", async () => {
    const response = await POST(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
    expect(runDueConnectionSyncsMock).not.toHaveBeenCalled();
  });

  it("accepts the correct CONNECTION_SYNC_SECRET, calls the runner exactly once, and returns its result", async () => {
    runDueConnectionSyncsMock.mockResolvedValueOnce({ claimed: 2, completed: 1, failed: 1 });

    const response = await POST(makeRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(runDueConnectionSyncsMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ claimed: 2, completed: 1, failed: 1 });
  });
});
