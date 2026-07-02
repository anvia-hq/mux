import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  Model,
  ProviderAdapter,
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";

const REQUEST_TIMEOUT_MS = 60_000;

export class CustomOpenAICompatibleAdapter implements ProviderAdapter {
  readonly capabilities = { ...openAICompatibleCapabilities, responsesApi: false };
  private readonly apiKey: string;
  private readonly chatCompletionsUrl: string;
  private readonly embeddingsUrl: string;
  private readonly models: Model[];

  constructor(input: { name: string; apiKey: string; apiBase: string; models: Model[] }) {
    this.name = input.name;
    this.apiKey = input.apiKey;
    this.chatCompletionsUrl = this.toChatCompletionsUrl(input.apiBase);
    this.embeddingsUrl = this.toEndpointUrl(input.apiBase, "embeddings");
    this.models = input.models;
  }

  readonly name: string;

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: buildOpenAICompatibleRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: buildOpenAICompatibleRequestBody(request, true),
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
        } catch (error) {
          throw new Error(
            `Failed to parse ${this.name} SSE chunk: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await fetch(this.embeddingsUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as EmbeddingResponse;
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

  private toChatCompletionsUrl(apiBase: string): string {
    return this.toEndpointUrl(apiBase, "chat/completions");
  }

  private toEndpointUrl(apiBase: string, endpoint: string): string {
    const normalized = apiBase.replace(/\/$/, "");
    if (normalized.endsWith(`/${endpoint}`)) {
      return normalized;
    }
    if (normalized.endsWith("/chat/completions")) {
      return normalized.replace(/\/chat\/completions$/, `/${endpoint}`);
    }
    return `${normalized}/${endpoint}`;
  }
}
