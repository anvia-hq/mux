import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Model,
  ProviderAdapter,
} from "./types";

const REQUEST_TIMEOUT_MS = 60_000;

export class ModelsDevProviderAdapter implements ProviderAdapter {
  name: string;
  private apiKey: string;
  private chatCompletionsUrl?: string;
  private models: Model[];

  constructor(input: { name: string; apiKey: string; apiBase?: string; models: Model[] }) {
    this.name = input.name;
    this.apiKey = input.apiKey;
    this.chatCompletionsUrl = input.apiBase ? this.toChatCompletionsUrl(input.apiBase) : undefined;
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
    return JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      stream,
    });
  }

  private toChatCompletionsUrl(apiBase: string): string {
    const normalized = apiBase.replace(/\/$/, "");
    return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
  }
}
