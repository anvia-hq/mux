import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Model,
  ProviderAdapter,
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Pinned api-version for Azure Responses on Azure OpenAI / Microsoft
 * Foundry. The OpenAI Responses spec on Azure requires this query
 * parameter. Overridable per adapter if Azure ships a newer preview
 * the gateway wants to opt into.
 */
export const AZURE_OPENAI_RESPONSES_API_VERSION = "2025-04-01-preview";

export class ModelsDevProviderAdapter implements ProviderAdapter {
  name: string;
  capabilities = openAICompatibleCapabilities;
  private apiKey: string;
  private chatCompletionsUrl?: string;
  /**
   * Base URL the adapter posts to for Responses API calls, if the
   * upstream exposes the OpenAI Responses surface. Set via the
   * `responsesEndpoint` constructor argument. Used by adapters such
   * as `AzureCognitiveServicesAdapter` and `AzureAdapter` that need
   * to call a vendor-specific base for Responses.
   */
  protected responsesEndpoint?: string;
  private models: Model[];

  constructor(input: {
    name: string;
    apiKey: string;
    apiBase?: string;
    responsesEndpoint?: string;
    models: Model[];
  }) {
    this.name = input.name;
    this.apiKey = input.apiKey;
    this.chatCompletionsUrl = input.apiBase ? this.toChatCompletionsUrl(input.apiBase) : undefined;
    this.responsesEndpoint = input.responsesEndpoint;
    this.models = input.models;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.chatCompletionsUrl) {
      throw new Error(`${this.name} does not expose a chat completions URL in models.dev`);
    }

    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    if (!this.chatCompletionsUrl) {
      throw new Error(`${this.name} does not expose a chat completions URL in models.dev`);
    }

    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch (err) {
          throw new Error(
            `Failed to parse ${this.name} SSE chunk: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  listModels(): Model[] {
    return this.models;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    return buildOpenAICompatibleRequestBody(request, stream);
  }

  private toChatCompletionsUrl(apiBase: string): string {
    const normalized = apiBase.replace(/\/$/, "");
    return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
  }
}
