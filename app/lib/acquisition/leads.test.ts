import { describe, expect, test } from "vitest";

import { normalizeAcquisitionEmail, validateLeadInput } from "./leads";

describe("beta lead validation", () => {
  test("normalizes email independently of casing and surrounding whitespace", () => {
    expect(normalizeAcquisitionEmail(" Ada@Example.COM ")).toBe("ada@example.com");
  });

  test("accepts minimal opt-in registration and preserves UTM attribution", () => {
    expect(validateLeadInput({ email: "ada@example.com", firstName: " Ada ", utmSource: "linkedin", utmCampaign: "beta" })).toMatchObject({
      email: "ada@example.com", firstName: "Ada", utmSource: "linkedin", utmCampaign: "beta",
    });
  });

  test("rejects malformed email", () => {
    expect(() => validateLeadInput({ email: "not-an-email" })).toThrow("adresse e-mail valide");
  });
});
