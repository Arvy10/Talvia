import { AnthropicProvider } from "./anthropic-provider";
import { GeminiProvider } from "./gemini-provider";
import type { AIProvider } from "./provider";

export * from "./provider";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

type ProviderName = "anthropic" | "gemini";

// AI_PROVIDER forces a choice when both keys happen to be set; otherwise
// whichever key is present decides, Gemini taking priority since it's the
// default provider for this deployment.
function resolveProviderName(): ProviderName | null {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit === "anthropic" || explicit === "gemini") return explicit;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

// Returns null (never throws) when no key is configured — callers decide
// how to respond (BusinessAnalyzer turns this into a clean "unavailable"
// result rather than crashing).
export function getAIProvider(): AIProvider | null {
  const providerName = resolveProviderName();

  if (providerName === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const model = process.env.BUSINESS_ANALYZER_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    return new GeminiProvider(apiKey, model);
  }

  if (providerName === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const model = process.env.BUSINESS_ANALYZER_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
    return new AnthropicProvider(apiKey, model);
  }

  return null;
}
