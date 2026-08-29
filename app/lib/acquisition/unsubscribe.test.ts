import { afterEach, expect, test, vi } from "vitest";

import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

afterEach(() => vi.unstubAllEnvs());

test("creates a signed unsubscribe token that rejects tampering", () => {
  vi.stubEnv("ACQUISITION_UNSUBSCRIBE_SECRET", "long-enough-test-secret");
  const leadId = "11111111-1111-4111-8111-111111111111";
  const token = createUnsubscribeToken(leadId);
  expect(verifyUnsubscribeToken(token)).toBe(leadId);
  expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
});
