import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 60_000;

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
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
              `Failed to parse OpenAI SSE chunk: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
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

  listModels(): Model[] {
    return [
      { id: "gpt-4o", name: "GPT-4o", provider: this.name },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: this.name },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: this.name },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: this.name },
    ];
  }
}
