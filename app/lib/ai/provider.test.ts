import { describe, expect, it } from "vitest";
import { describeProviderError } from "./provider";

// Regression guard: a raw provider error like Gemini's
// {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}} must never
// reach the end user verbatim — it happened once already and looked like a
// broken app rather than "the AI service is briefly overloaded".
describe("describeProviderError", () => {
  it("turns a raw 503/UNAVAILABLE payload into a friendly overload message", () => {
    const error = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
    const message = describeProviderError(error, "Gemini");
    expect(message).not.toContain("{");
    expect(message).toMatch(/surchargé/i);
  });

  it("turns a 429/rate-limit payload into a friendly overload message", () => {
    const error = new Error("429 Too Many Requests: rate_limit_exceeded");
    expect(describeProviderError(error, "Anthropic")).toMatch(/surchargé/i);
  });

  it("turns an auth error into a friendly key message", () => {
    const error = new Error("401 UNAUTHENTICATED: invalid api key");
    expect(describeProviderError(error, "Gemini")).toMatch(/clé API/i);
  });

  it("falls back to a generic clean message for anything unrecognized", () => {
    const error = new Error("some obscure internal SDK stack trace");
    const message = describeProviderError(error, "Gemini");
    expect(message).not.toContain("obscure internal SDK stack trace");
  });
});
