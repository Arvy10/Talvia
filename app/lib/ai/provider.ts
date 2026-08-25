// Provider-agnostic contract. Business logic depends only on this interface,
// never on a specific vendor SDK — swapping providers/models later means
// writing a new class here, not touching BusinessAnalyzer.

export type JSONSchema = Record<string, unknown>;

export type StructuredGenerationRequest = {
  system: string;
  prompt: string;
  schemaName: string;
  schema: JSONSchema;
  maxTokens?: number;
};

export type StructuredGenerationResult<T> = {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export class AIProviderUnavailableError extends Error {}
export class AIProviderResponseError extends Error {}

export interface AIProvider {
  readonly model: string;
  generateStructured<T>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>>;
}

export const AI_REQUEST_TIMEOUT_MS = 20_000;

// Neither SDK enforces a bound on its own, so a slow or hung provider call
// used to leave the frontend spinning indefinitely with no way to recover.
// This never cancels the underlying HTTP request (no AbortController wired
// through either SDK today) — it just stops the caller from waiting past
// the timeout, so the user always gets a clear failure instead of an
// infinite "analyse en cours".
export function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AIProviderResponseError(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// Anthropic/Gemini SDK errors often carry the raw HTTP error body as
// `.message` (sometimes literal JSON like `{"error":{"code":503,...}}`) —
// never worth showing a user directly. This turns whatever the SDK threw
// into a short, actionable French message; the raw error itself is still
// available to whoever calls console.error on it upstream.
export function describeProviderError(error: unknown, providerLabel: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/\b(503|UNAVAILABLE|overloaded|rate.?limit|429|TOO_MANY_REQUESTS)\b/i.test(raw)) {
    return `Le service ${providerLabel} est temporairement surchargé. Réessayez dans quelques instants.`;
  }
  if (/\b(401|403|PERMISSION_DENIED|invalid.?api.?key|UNAUTHENTICATED)\b/i.test(raw)) {
    return `Le service ${providerLabel} a refusé la demande (clé API invalide ou insuffisante).`;
  }
  return `Le service ${providerLabel} a rencontré un problème. Réessayez dans quelques instants.`;
}
