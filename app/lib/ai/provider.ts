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
