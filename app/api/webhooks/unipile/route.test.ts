import { beforeEach, describe, expect, it, vi } from "vitest";

// This route is Talvia's only externally-authenticated (no user session)
// endpoint, with two DELIBERATELY SEPARATE authentication mechanisms — a
// one-time token (hosted-auth-notify) and a shared header (persistent
// webhook subscription). Both are tested directly against the real exported
// POST handler, never mixed.

const ingestHostedAuthNotificationMock = vi.hoisted(() => vi.fn(async () => undefined));
const ingestAccountStatusMock = vi.hoisted(() => vi.fn(async () => undefined));
const ingestMessageMock = vi.hoisted(() => vi.fn(async () => ({ status: "ingested" as const })));
const resolveConnectionAuthAttemptMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/providers/unipile-adapter", () => ({
  ingestHostedAuthNotification: ingestHostedAuthNotificationMock,
  ingestAccountStatus: ingestAccountStatusMock,
  ingestMessage: ingestMessageMock,
  resolveConnectionAuthAttempt: resolveConnectionAuthAttemptMock,
}));

const getUnipileConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/providers/unipile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/providers/unipile")>()),
  getUnipileConfig: getUnipileConfigMock,
}));

const { POST } = await import("./route");

const SECRET = "test-webhook-secret";
const VALID_TOKEN = "a-valid-one-time-token";
const RESOLVED_ATTEMPT = { workspaceId: "ws-1", channelType: "whatsapp" as const };

beforeEach(() => {
  ingestHostedAuthNotificationMock.mockClear();
  ingestAccountStatusMock.mockClear();
  ingestMessageMock.mockClear();
  resolveConnectionAuthAttemptMock.mockReset();
  resolveConnectionAuthAttemptMock.mockImplementation(async (token: string) => (token === VALID_TOKEN ? RESOLVED_ATTEMPT : null));
  getUnipileConfigMock.mockReset();
  getUnipileConfigMock.mockReturnValue({ apiKey: "k", apiUrl: "https://api.test", webhookSecret: SECRET, appBaseUrl: "https://app.test" });
});

function makeRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const hostedAuthPayload = { status: "CREATION_SUCCESS", account_id: "acct-1", name: "ws-1::whatsapp" };
const accountStatusPayload = { AccountStatus: { account_id: "acct-1", account_type: "WHATSAPP", message: "creation_success" } };

describe("POST /api/webhooks/unipile — hosted-auth-notify path (token)", () => {
  it("a valid token resolves the connection attempt and ingests the payload", async () => {
    const response = await POST(makeRequest(`https://app.test/api/webhooks/unipile?token=${VALID_TOKEN}`, hostedAuthPayload));
    expect(response.status).toBe(200);
    expect(resolveConnectionAuthAttemptMock).toHaveBeenCalledWith(VALID_TOKEN, hostedAuthPayload.account_id);
    expect(ingestHostedAuthNotificationMock).toHaveBeenCalledWith(hostedAuthPayload, RESOLVED_ATTEMPT);
  });

  it("an unknown or expired token is rejected — resolveConnectionAuthAttempt returning null", async () => {
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile?token=unknown-or-expired", hostedAuthPayload));
    expect(response.status).toBe(401);
    expect(ingestHostedAuthNotificationMock).not.toHaveBeenCalled();
  });

  it("a token present alongside a non-hosted-auth-notify payload is rejected, not silently misrouted", async () => {
    const response = await POST(makeRequest(`https://app.test/api/webhooks/unipile?token=${VALID_TOKEN}`, accountStatusPayload));
    expect(response.status).toBe(400);
    expect(ingestAccountStatusMock).not.toHaveBeenCalled();
    expect(resolveConnectionAuthAttemptMock).not.toHaveBeenCalled();
  });

  it("a valid token authenticates even with no Unipile-Auth header at all — the two mechanisms are independent", async () => {
    const response = await POST(makeRequest(`https://app.test/api/webhooks/unipile?token=${VALID_TOKEN}`, hostedAuthPayload, {}));
    expect(response.status).toBe(200);
  });

  it("Unipile-Auth header is never consulted on the token path, even if present and correct", async () => {
    const response = await POST(makeRequest(`https://app.test/api/webhooks/unipile?token=unknown-or-expired`, hostedAuthPayload, { "unipile-auth": SECRET }));
    // The header must not rescue an invalid token — the two mechanisms are
    // never mixed.
    expect(response.status).toBe(401);
    expect(ingestHostedAuthNotificationMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/unipile — persistent webhook path (Unipile-Auth header)", () => {
  it("accepts a valid Unipile-Auth header and dispatches an AccountStatus payload", async () => {
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", accountStatusPayload, { "unipile-auth": SECRET }));
    expect(response.status).toBe(200);
    expect(ingestAccountStatusMock).toHaveBeenCalledWith(accountStatusPayload.AccountStatus);
  });

  it("rejects a request with no token and no matching header", async () => {
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", accountStatusPayload));
    expect(response.status).toBe(401);
    expect(ingestAccountStatusMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect header", async () => {
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", accountStatusPayload, { "unipile-auth": "wrong-value" }));
    expect(response.status).toBe(401);
    expect(ingestAccountStatusMock).not.toHaveBeenCalled();
  });

  it("an unrecognized payload shape falls through to ingestMessage in a controlled way, never throws", async () => {
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", { event: "message_received", account_id: "acct-1" }, { "unipile-auth": SECRET }));
    expect(response.status).toBe(200);
    expect(ingestMessageMock).toHaveBeenCalledTimes(1);
  });

  it("an ingestion failure returns 500 instead of a fabricated success", async () => {
    ingestAccountStatusMock.mockRejectedValueOnce(new Error("db down"));
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", accountStatusPayload, { "unipile-auth": SECRET }));
    expect(response.status).toBe(500);
  });
});

describe("POST /api/webhooks/unipile — malformed input", () => {
  it("invalid JSON body returns 400 without throwing", async () => {
    const request = new Request("https://app.test/api/webhooks/unipile", { method: "POST", headers: { "content-type": "application/json", "unipile-auth": SECRET }, body: "not json" });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(ingestHostedAuthNotificationMock).not.toHaveBeenCalled();
    expect(ingestAccountStatusMock).not.toHaveBeenCalled();
    expect(ingestMessageMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/unipile — Unipile not configured", () => {
  it("returns 503 when getUnipileConfig() is null, before any auth check", async () => {
    getUnipileConfigMock.mockReturnValue(null);
    const response = await POST(makeRequest("https://app.test/api/webhooks/unipile", accountStatusPayload, { "unipile-auth": SECRET }));
    expect(response.status).toBe(503);
  });
});
