import { AnthropicProvider } from "./anthropic-provider";
import type { AIProvider } from "./provider";

export * from "./provider";

const DEFAULT_MODEL = "claude-haiku-4-5";

// Returns null (never throws) when no key is configured — callers decide
// how to respond (BusinessAnalyzer turns this into a clean "unavailable"
// result rather than crashing).
export function getAIProvider(): AIProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.BUSINESS_ANALYZER_MODEL?.trim() || DEFAULT_MODEL;
  return new AnthropicProvider(apiKey, model);
}
