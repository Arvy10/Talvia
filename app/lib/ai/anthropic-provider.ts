import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/index";

import {
  AI_REQUEST_TIMEOUT_MS,
  AIProviderResponseError,
  raceWithTimeout,
  type AIProvider,
  type JSONSchema,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "./provider";

// The only file in the codebase allowed to import "@anthropic-ai/sdk".
// BusinessAnalyzer and everything above it depend on the AIProvider
// interface only, so swapping vendor or model later means adding a
// sibling class here, not touching domain logic.
export class AnthropicProvider implements AIProvider {
  private readonly client: Anthropic;
  readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateStructured<T>(request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>> {
    const schema = { ...request.schema, type: "object" as const } as JSONSchema & { type: "object" };
    let message;
    try {
      message = await raceWithTimeout(
        this.client.messages.parse({
          model: this.model,
          max_tokens: request.maxTokens ?? 4096,
          system: request.system,
          output_config: { format: jsonSchemaOutputFormat(schema) },
          messages: [{ role: "user", content: request.prompt }],
        }),
        AI_REQUEST_TIMEOUT_MS,
        "Le fournisseur IA a mis trop de temps à répondre.",
      );
    } catch (error) {
      if (error instanceof AIProviderResponseError) throw error;
      throw new AIProviderResponseError(error instanceof Error ? error.message : "Anthropic request failed.");
    }

    if (message.stop_reason === "refusal") {
      throw new AIProviderResponseError(`Model refused the request (${message.stop_details?.category ?? "unknown category"}).`);
    }
    if (!message.parsed_output) {
      throw new AIProviderResponseError("Model response did not match the requested schema.");
    }

    return {
      data: message.parsed_output as T,
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
