import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const MODELS: Model[] = [
  {
    id: "codestral-latest",
    name: "Codestral (latest)",
    provider: "mistral",
    inputPricePer1M: 0.3,
    outputPricePer1M: 0.9,
    contextWindow: 256000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-large-latest",
    name: "Mistral Large (latest)",
    provider: "mistral",
    inputPricePer1M: 0.5,
    outputPricePer1M: 1.5,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "open-mistral-7b",
    name: "Mistral 7B",
    provider: "mistral",
    inputPricePer1M: 0.25,
    outputPricePer1M: 0.25,
    contextWindow: 8000,
    maxOutputTokens: 8000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "devstral-small-2507",
    name: "Devstral Small",
    provider: "mistral",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.3,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "ministral-3b-latest",
    name: "Ministral 3B (latest)",
    provider: "mistral",
    inputPricePer1M: 0.04,
    outputPricePer1M: 0.04,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "pixtral-large-latest",
    name: "Pixtral Large (latest)",
    provider: "mistral",
    inputPricePer1M: 2,
    outputPricePer1M: 6,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-nemo",
    name: "Mistral Nemo",
    provider: "mistral",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.15,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-embed",
    name: "Mistral Embed",
    provider: "mistral",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0,
    contextWindow: 8000,
    maxOutputTokens: 3072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "mistral-small-2506",
    name: "Mistral Small 3.2",
    provider: "mistral",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.3,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "ministral-8b-latest",
    name: "Ministral 8B (latest)",
    provider: "mistral",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.1,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "open-mixtral-8x22b",
    name: "Mixtral 8x22B",
    provider: "mistral",
    inputPricePer1M: 2,
    outputPricePer1M: 6,
    contextWindow: 64000,
    maxOutputTokens: 64000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-medium-latest",
    name: "Mistral Medium (latest)",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "devstral-small-2505",
    name: "Devstral Small 2505",
    provider: "mistral",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.3,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "magistral-small",
    name: "Magistral Small",
    provider: "mistral",
    inputPricePer1M: 0.5,
    outputPricePer1M: 1.5,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-medium-2604",
    name: "Mistral Medium 3.5",
    provider: "mistral",
    inputPricePer1M: 1.5,
    outputPricePer1M: 7.5,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "mistral-small-latest",
    name: "Mistral Small (latest)",
    provider: "mistral",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    contextWindow: 256000,
    maxOutputTokens: 256000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "open-mixtral-8x7b",
    name: "Mixtral 8x7B",
    provider: "mistral",
    inputPricePer1M: 0.7,
    outputPricePer1M: 0.7,
    contextWindow: 32000,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "devstral-latest",
    name: "Devstral 2",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-small-2603",
    name: "Mistral Small 4",
    provider: "mistral",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    contextWindow: 256000,
    maxOutputTokens: 256000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-medium-2505",
    name: "Mistral Medium 3",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 131072,
    maxOutputTokens: 131072,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "mistral-large-2411",
    name: "Mistral Large 2.1",
    provider: "mistral",
    inputPricePer1M: 2,
    outputPricePer1M: 6,
    contextWindow: 131072,
    maxOutputTokens: 16384,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-medium-2508",
    name: "Mistral Medium 3.1",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "open-mistral-nemo",
    name: "Open Mistral Nemo",
    provider: "mistral",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.15,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "magistral-medium-latest",
    name: "Magistral Medium (latest)",
    provider: "mistral",
    inputPricePer1M: 2,
    outputPricePer1M: 5,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "devstral-medium-latest",
    name: "Devstral 2 (latest)",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "devstral-2512",
    name: "Devstral 2",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "labs-devstral-small-2512",
    name: "Devstral Small 2",
    provider: "mistral",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 256000,
    maxOutputTokens: 256000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "pixtral-12b",
    name: "Pixtral 12B",
    provider: "mistral",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.15,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "mistral-large-2512",
    name: "Mistral Large 3",
    provider: "mistral",
    inputPricePer1M: 0.5,
    outputPricePer1M: 1.5,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "devstral-medium-2507",
    name: "Devstral Medium",
    provider: "mistral",
    inputPricePer1M: 0.4,
    outputPricePer1M: 2,
    contextWindow: 128000,
    maxOutputTokens: 128000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

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
    return MODELS;
  }
}
