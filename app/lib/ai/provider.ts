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
