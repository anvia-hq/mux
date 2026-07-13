import type {
  AnthropicMessageCountTokensRequest,
  AnthropicMessageCreateRequest,
  AnthropicMessageObject,
  AnthropicMessageTokenCountObject,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  ProviderRequestOptions,
  Model,
  ChatContentPart,
  ChatMessage,
  ToolCall,
} from "./types";
import { mergeProviderRequestHeaders } from "./types";
import { anthropicCapabilities } from "./chat-compat";
import { throwOpenAICompatibleError } from "./openai-compatible-error";

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

export class UpstreamAnthropicMessagesApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly contentType: string | null;

  constructor(status: number, body: string, contentType: string | null) {
    super(`Anthropic Messages API error: ${status} - ${body}`);
    this.name = "UpstreamAnthropicMessagesApiError";
    this.status = status;
    this.body = body;
    this.contentType = contentType;
  }
}

function withPricingInputTokens<
  T extends { prompt_tokens: number; completion_tokens: number; total_tokens: number },
>(usage: T, pricingInputTokens: number): T & { pricing_input_tokens?: number } {
  Object.defineProperty(usage, "pricing_input_tokens", {
    value: pricingInputTokens,
    enumerable: false,
  });
  return usage;
}

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  capabilities = anthropicCapabilities;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => contentToText(m.content))
      .filter(Boolean)
      .join("\n\n");
    const nonSystem: { role: "assistant" | "user"; content: unknown[] | string }[] = [];
    for (const message of messages) {
      if (message.role === "system") continue;
      const role = message.role === "assistant" ? "assistant" : "user";
      const content = this.convertMessageContent(message);
      const previous = nonSystem.at(-1);
      if (message.role === "tool" && previous?.role === "user") {
        const previousContent = Array.isArray(previous.content)
          ? previous.content
          : [{ type: "text", text: previous.content }];
        previous.content = [...previousContent, ...(Array.isArray(content) ? content : [content])];
      } else {
        nonSystem.push({ role, content });
      }
    }
    return { system, messages: nonSystem };
  }

  private convertMessageContent(message: ChatMessage): unknown[] | string {
    if (message.role === "tool") {
      return [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: contentToText(message.content),
        },
      ];
    }

    const content = Array.isArray(message.content)
      ? message.content.flatMap((part) => this.convertContentPart(part))
      : message.content == null
        ? []
        : [{ type: "text", text: message.content }];

    if (message.tool_calls?.length) {
      content.push(
        ...message.tool_calls.map((toolCall) => ({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: safeJsonObject(toolCall.function.arguments),
        })),
      );
    }

    return content;
  }

  private convertContentPart(part: ChatContentPart): unknown[] {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "refusal") return [{ type: "text", text: part.refusal }];
    if (part.type === "image_url") {
      const source = imageUrlToAnthropicSource(part.image_url.url);
      return source ? [{ type: "image", source }] : [{ type: "text", text: part.image_url.url }];
    }
    if (part.type === "file") {
      return [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: part.file.file_data ?? part.file.file_id ?? "",
          },
        },
      ];
    }
    return [{ type: "text", text: "" }];
  }

  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    const { system, messages } = this.convertMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.max_completion_tokens ?? request.max_tokens ?? 4096,
      messages,
      stream,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      body.top_p = request.top_p;
    }
    if (request.stop !== undefined) {
      body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? { type: "object", properties: {} },
      }));
    }
    if (request.tool_choice !== undefined || request.parallel_tool_calls !== undefined) {
      body.tool_choice = toAnthropicToolChoice(request.tool_choice, request.parallel_tool_calls);
    }
    return JSON.stringify(body);
  }

  private buildHeaders(options?: ProviderRequestOptions): Record<string, string> {
    return mergeProviderRequestHeaders(
      {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      options,
    );
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? this.buildRequestBody(request, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("Anthropic", response);
    }

    const data = (await response.json()) as {
      id: string;
      model: string;
      content: (
        | { type?: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      )[];
      stop_reason: string | null;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    const content = data.content ?? [];
    const text = content
      .filter((part): part is { text: string } => "text" in part && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    const toolCalls = content
      .filter(
        (part): part is { type: "tool_use"; id: string; name: string; input: unknown } =>
          "type" in part && part.type === "tool_use",
      )
      .map(
        (part): ToolCall => ({
          id: part.id,
          type: "function",
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        }),
      );

    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: data.stop_reason ? toOpenAIFinishReason(data.stop_reason) : null,
        },
      ],
      usage: withPricingInputTokens(
        {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        },
        data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens ?? 0) +
          (data.usage.cache_read_input_tokens ?? 0),
      ),
    };
  }

  async *chatCompletionStream(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? this.buildRequestBody(request, true),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("Anthropic", response);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let messageId = `anthropic-${Date.now()}`;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let cacheCreationTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    const toolCallIndexes = new Map<number, number>();
    let nextToolCallIndex = 0;
    let stopReason: string | undefined;
    let finishEmitted = false;

    const usageChunk = (): ChatCompletionChunk["usage"] | undefined =>
      promptTokens !== undefined || completionTokens !== undefined
        ? withPricingInputTokens(
            {
              prompt_tokens: promptTokens ?? 0,
              completion_tokens: completionTokens ?? 0,
              total_tokens: (promptTokens ?? 0) + (completionTokens ?? 0),
            },
            (promptTokens ?? 0) + (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0),
          )
        : undefined;

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
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };
            index?: number;
            content_block?: {
              type?: string;
              id?: string;
              name?: string;
              text?: string;
            };
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              stop_reason?: string | null;
            };
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
          if (typeof data.message?.usage?.cache_creation_input_tokens === "number") {
            cacheCreationTokens = data.message.usage.cache_creation_input_tokens;
          }
          if (typeof data.message?.usage?.cache_read_input_tokens === "number") {
            cacheReadTokens = data.message.usage.cache_read_input_tokens;
          }
          if (typeof data.usage?.output_tokens === "number") {
            completionTokens = data.usage.output_tokens;
          }

          if (data.type === "message_start") {
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            };
          } else if (
            data.type === "content_block_start" &&
            data.content_block?.type === "tool_use"
          ) {
            const contentBlockIndex = data.index ?? 0;
            const toolCallIndex = nextToolCallIndex;
            nextToolCallIndex += 1;
            toolCallIndexes.set(contentBlockIndex, toolCallIndex);
            const toolCallId = data.content_block.id ?? `toolu_${toolCallIndex}`;
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        id: toolCallId,
                        type: "function",
                        function: { name: data.content_block.name ?? "", arguments: "" },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            };
          } else if (
            data.type === "content_block_start" &&
            data.content_block?.type === "text" &&
            data.content_block.text
          ) {
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: data.content_block.text },
                  finish_reason: null,
                },
              ],
            };
          } else if (
            data.type === "content_block_delta" &&
            data.delta?.type === "input_json_delta"
          ) {
            const contentBlockIndex = data.index ?? 0;
            const toolCallIndex = toolCallIndexes.get(contentBlockIndex) ?? 0;
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: toolCallIndex,
                        function: {
                          arguments: data.delta.partial_json ?? "",
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            };
          } else if (
            data.type === "content_block_delta" &&
            (data.delta?.type === "text_delta" || typeof data.delta?.text === "string")
          ) {
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
          } else if (data.type === "message_delta") {
            if (data.delta?.stop_reason && !finishEmitted) {
              stopReason = data.delta.stop_reason;
              finishEmitted = true;
              yield {
                id: messageId,
                model: request.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: toOpenAIFinishReason(stopReason),
                  },
                ],
              };
            }
          } else if (data.type === "message_stop") {
            if (!finishEmitted) {
              finishEmitted = true;
              yield {
                id: messageId,
                model: request.model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason:
                      stopReason !== undefined
                        ? toOpenAIFinishReason(stopReason)
                        : toolCallIndexes.size > 0
                          ? "tool_calls"
                          : "stop",
                  },
                ],
              };
            }
            const usage = usageChunk();
            if (usage) {
              yield {
                id: messageId,
                model: request.model,
                choices: [],
                usage,
              };
            }
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

  async createAnthropicMessage(
    request: AnthropicMessageCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<AnthropicMessageObject> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await upstreamAnthropicMessagesError(response);
    }

    return (await response.json()) as AnthropicMessageObject;
  }

  async *createAnthropicMessageStream(
    request: AnthropicMessageCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await upstreamAnthropicMessagesError(response);
    }

    yield* streamRawResponseBody(response);
  }

  async countAnthropicMessageTokens(
    request: AnthropicMessageCountTokensRequest,
    options?: ProviderRequestOptions,
  ): Promise<AnthropicMessageTokenCountObject> {
    const response = await fetch(`${ANTHROPIC_API_URL}/count_tokens`, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await upstreamAnthropicMessagesError(response);
    }

    return (await response.json()) as AnthropicMessageTokenCountObject;
  }

  listModels(): Model[] {
    return MODELS;
  }
}

async function upstreamAnthropicMessagesError(
  response: Response,
): Promise<UpstreamAnthropicMessagesApiError> {
  const body = await response.text();
  return new UpstreamAnthropicMessagesApiError(
    response.status,
    body,
    response.headers.get("Content-Type"),
  );
}

async function* streamRawResponseBody(response: Response): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
  const remaining = decoder.decode();
  if (remaining) yield remaining;
}

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function imageUrlToAnthropicSource(
  url: string,
): { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } | null {
  if (!url.startsWith("data:")) return { type: "url", url };
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { type: "base64", media_type: match[1] ?? "image/png", data: match[2] ?? "" };
}

function toAnthropicToolChoice(
  toolChoice: ChatCompletionRequest["tool_choice"],
  parallelToolCalls?: boolean,
): unknown {
  let result: Record<string, unknown> | undefined;
  if (toolChoice === "auto") result = { type: "auto" };
  if (toolChoice === "required") result = { type: "any" };
  if (toolChoice === "none") result = { type: "none" };
  if (toolChoice && typeof toolChoice === "object") {
    result = { type: "tool", name: toolChoice.function.name };
  }
  if (!result && parallelToolCalls !== undefined) result = { type: "auto" };
  if (result && result.type !== "none" && parallelToolCalls !== undefined) {
    result.disable_parallel_tool_use = !parallelToolCalls;
  }
  return result;
}

function toOpenAIFinishReason(reason: string): string {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  if (reason === "refusal") return "content_filter";
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  return reason;
}
