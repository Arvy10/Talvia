import { GoogleGenAI } from "@google/genai";

import {
  AI_REQUEST_TIMEOUT_MS,
  AIProviderResponseError,
  describeProviderError,
  raceWithTimeout,
  type AIProvider,
  type JSONSchema,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "./provider";

const BLOCKING_FINISH_REASONS = new Set(["SAFETY", "RECITATION", "LANGUAGE", "BLOCKED_SAFETY", "BLOCKED_OTHER", "BLOCKED_UNKNOWN", "OTHER"]);

// The only file in the codebase allowed to import "@google/genai" — mirrors
// AnthropicProvider so BusinessAnalyzer stays vendor-agnostic.
export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;
  readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateStructured<T>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
    const schema = { ...request.schema, type: "object" as const } as JSONSchema & { type: "object" };
    let response;
    try {
      response = await raceWithTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: request.prompt,
          config: {
            systemInstruction: request.system,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            maxOutputTokens: request.maxTokens ?? 4096,
          },
        }),
        AI_REQUEST_TIMEOUT_MS,
        "Le fournisseur IA a mis trop de temps à répondre.",
      );
    } catch (error) {
      if (error instanceof AIProviderResponseError) throw error;
      throw new AIProviderResponseError(describeProviderError(error, "Gemini"));
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && BLOCKING_FINISH_REASONS.has(finishReason)) {
      throw new AIProviderResponseError("Le modèle a refusé ou bloqué cette demande.");
    }

    const text = response.text;
    if (!text) {
      throw new AIProviderResponseError("Le modèle n'a renvoyé aucun contenu.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIProviderResponseError("La réponse du modèle n'était pas un JSON valide.");
    }

    return {
      data: parsed as T,
      model: this.model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
