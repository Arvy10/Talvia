import { afterEach, describe, expect, test, vi } from "vitest";

import { sendAcquisitionEmail } from "./resend";

describe("Resend acquisition adapter", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("sends an opted-in email with reply-to and unsubscribe header", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RESEND_EMAIL_FROM", "Talvia <hello@example.com>"); vi.stubEnv("RESEND_EMAIL_REPLY_TO", "reply@example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "message-1" }), { status: 200 })));
    await expect(sendAcquisitionEmail({ to: "ada@example.com", subject: "Bienvenue", text: "Bonjour", html: "<p>Bonjour</p>", unsubscribeUrl: "https://app.test/u" })).resolves.toEqual({ providerMessageId: "message-1" });
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }));
  });
});
