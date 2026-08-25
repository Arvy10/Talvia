import { describe, expect, it } from "vitest";
import { analyzeBusinessFromWebsite } from "./business-analyzer";

describe("analyzeBusinessFromWebsite", () => {
  it("returns an unavailable result without crashing when no AI provider is configured", async () => {
    const outcome = await analyzeBusinessFromWebsite("https://example.com", null);
    expect(outcome.status).toBe("unavailable");
  });

  it("rejects a website that resolves to a private/loopback address before any AI call", async () => {
    const outcome = await analyzeBusinessFromWebsite("http://127.0.0.1", {
      model: "test-model",
      generateStructured: async () => {
        throw new Error("should not be called for an unsafe URL");
      },
    });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.reason).toMatch(/autorisée/);
  });

  it("rejects cloud metadata addresses before any AI call", async () => {
    const outcome = await analyzeBusinessFromWebsite("http://169.254.169.254/latest/meta-data", {
      model: "test-model",
      generateStructured: async () => {
        throw new Error("should not be called for an unsafe URL");
      },
    });
    expect(outcome.status).toBe("error");
  });
});
