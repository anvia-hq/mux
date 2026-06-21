import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const MODELS: Model[] = [
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5 (latest)",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    inputPricePer1M: 1,
    outputPricePer1M: 5,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude Haiku 3.5",
    provider: "anthropic",
    inputPricePer1M: 0.8,
    outputPricePer1M: 4,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-0",
    name: "Claude Opus 4 (latest)",
    provider: "anthropic",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-opus-20240229",
    name: "Claude Opus 3",
    provider: "anthropic",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-1-20250805",
    name: "Claude Opus 4.1",
    provider: "anthropic",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5 (latest)",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude Sonnet 3.5 v2",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "anthropic",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-5-sonnet-20240620",
    name: "Claude Sonnet 3.5",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-1",
    name: "Claude Opus 4.1 (latest)",
    provider: "anthropic",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude Haiku 3",
    provider: "anthropic",
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.25,
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    provider: "anthropic",
    inputPricePer1M: 10,
    outputPricePer1M: 50,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-sonnet-4-0",
    name: "Claude Sonnet 4 (latest)",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude Sonnet 3.7",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5 (latest)",
    provider: "anthropic",
    inputPricePer1M: 1,
    outputPricePer1M: 5,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-sonnet-20240229",
    name: "Claude Sonnet 3",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claude-3-5-haiku-latest",
    name: "Claude Haiku 3.5 (latest)",
    provider: "anthropic",
    inputPricePer1M: 0.8,
    outputPricePer1M: 4,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const REQUEST_TIMEOUT_MS = 60_000;

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const system = messages.find((m) => m.role === "system")?.content;
    const nonSystem = messages.filter((m) => m.role !== "system");
    return { system, messages: nonSystem };
  }

  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    const { system, messages } = this.convertMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      system,
      messages,
      stream,
    };
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    return JSON.stringify(body);
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      id: string;
      model: string;
      content: { text: string }[];
      stop_reason: string | null;
      usage: { input_tokens: number; output_tokens: number };
    };

    // Convert Anthropic response to OpenAI format
    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.content?.[0]?.text ?? "",
          },
          finish_reason: data.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let messageId = `anthropic-${Date.now()}`;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          let data: {
            type: string;
            id?: string;
            message?: {
              id?: string;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            delta?: { text?: string };
            usage?: { output_tokens?: number };
            error?: { type?: string; message?: string };
          };
          try {
            data = JSON.parse(line.slice(6));
          } catch (err) {
            throw new Error(
              `Failed to parse Anthropic SSE chunk: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          if (data.message?.id) {
            messageId = data.message.id;
          } else if (data.id) {
            messageId = data.id;
          }

          if (typeof data.message?.usage?.input_tokens === "number") {
            promptTokens = data.message.usage.input_tokens;
          }
          if (typeof data.message?.usage?.output_tokens === "number") {
            completionTokens = data.message.usage.output_tokens;
          }
          if (typeof data.usage?.output_tokens === "number") {
            completionTokens = data.usage.output_tokens;
          }

          // Convert Anthropic events to OpenAI format
          if (data.type === "content_block_delta") {
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: data.delta?.text ?? "" },
                  finish_reason: null,
                },
              ],
            };
          } else if (data.type === "message_stop") {
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
              usage:
                promptTokens !== undefined || completionTokens !== undefined
                  ? {
                      prompt_tokens: promptTokens ?? 0,
                      completion_tokens: completionTokens ?? 0,
                      total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
                    }
                  : undefined,
            };
          } else if (data.type === "error") {
            const message = data.error?.message ?? "Unknown Anthropic stream error";
            throw new Error(`Anthropic stream error: ${message}`);
          }
        }
      }
    }

    // Flush any remaining bytes from the decoder
    buffer += decoder.decode();
  }

  listModels(): Model[] {
    return MODELS;
  }
}
