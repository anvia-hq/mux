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

    const data: unknown = await response.json();
    this.assertChatCompletionResponse(data);
    return data;
  }

  private assertChatCompletionResponse(data: unknown): asserts data is ChatCompletionResponse {
    if (!data || typeof data !== "object") {
      throw new Error("Mistral API returned a non-object response");
    }
    const obj = data as Record<string, unknown>;
    if (typeof obj.id !== "string") {
      throw new Error("Mistral API response missing required string field 'id'");
    }
    if (typeof obj.model !== "string") {
      throw new Error("Mistral API response missing required string field 'model'");
    }
    if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
      throw new Error("Mistral API response missing or empty 'choices' array");
    }
    const firstChoice = obj.choices[0] as Record<string, unknown>;
    if (!firstChoice.message || typeof firstChoice.message !== "object") {
      throw new Error("Mistral API response missing 'choices[0].message'");
    }
    const message = firstChoice.message as Record<string, unknown>;
    if (message.role !== "assistant") {
      throw new Error("Mistral API response 'choices[0].message.role' must be 'assistant'");
    }
    if (typeof message.content !== "string") {
      throw new Error("Mistral API response missing string 'choices[0].message.content'");
    }
    if (firstChoice.finish_reason !== null && typeof firstChoice.finish_reason !== "string") {
      throw new Error("Mistral API response 'choices[0].finish_reason' must be string or null");
    }
    if (!obj.usage || typeof obj.usage !== "object") {
      throw new Error("Mistral API response missing 'usage' object");
    }
    const usage = obj.usage as Record<string, unknown>;
    if (
      typeof usage.prompt_tokens !== "number" ||
      typeof usage.completion_tokens !== "number" ||
      typeof usage.total_tokens !== "number"
    ) {
      throw new Error("Mistral API response 'usage' missing required numeric fields");
    }
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

    // Process SSE lines, yielding parsed chunks. Sets `done` if a [DONE] sentinel is seen.
    // Handles CRLF endings, SSE comments (":"), and empty separator lines.
    const processLines = function* (lines: string[]): Generator<ChatCompletionChunk> {
      for (const rawLine of lines) {
        // Trim a trailing CR for CRLF line endings
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        // Skip empty separator lines
        if (line.length === 0) continue;
        // Skip SSE comments (lines starting with ":")
        if (line.startsWith(":")) continue;
        // Skip non-data lines (e.g. "event:" lines)
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") {
          done = true;
          return;
        }
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch (err) {
          throw new Error(
            `Failed to parse Mistral SSE chunk: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    let done = false;

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      yield* processLines(lines);
      if (done) return;
    }

    // Flush any remaining bytes from the decoder and process any trailing SSE lines.
    // The last element after splitting may be a partial line (no trailing newline);
    // we only treat it as complete if it has non-whitespace content after CR trim.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const trailing = buffer.split("\n");
      const last = trailing[trailing.length - 1];
      const trimmedLast = last.endsWith("\r") ? last.slice(0, -1) : last;
      const complete = trimmedLast.length > 0 ? trailing : trailing.slice(0, -1);
      yield* processLines(complete);
    }
  }

  listModels(): Model[] {
    return [
      { id: "mistral-large-latest", name: "Mistral Large", provider: this.name },
      { id: "mistral-medium-latest", name: "Mistral Medium", provider: this.name },
      { id: "mistral-small-latest", name: "Mistral Small", provider: this.name },
    ];
  }
}
