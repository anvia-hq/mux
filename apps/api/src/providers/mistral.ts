import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;

export class MistralAdapter implements ProviderAdapter {
  name = "mistral";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
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

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
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

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data);
          } catch (err) {
            throw new Error(
              `Failed to parse Mistral SSE chunk: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    // Flush any remaining bytes from the decoder
    buffer += decoder.decode();
  }

  listModels(): Model[] {
    return [
      { id: "mistral-large-latest", name: "Mistral Large", provider: this.name },
      { id: "mistral-medium-latest", name: "Mistral Medium", provider: this.name },
      { id: "mistral-small-latest", name: "Mistral Small", provider: this.name },
    ];
  }
}
