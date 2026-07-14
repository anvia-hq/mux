import type {
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
import { googleCapabilities } from "./chat-compat";
import { throwOpenAICompatibleError } from "./openai-compatible-error";
import { createToolCallId } from "./tool-calls";
import { SseBlockParser } from "./responses-stream";

const MODELS: Model[] = [
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    provider: "google",
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.5,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-2.5-flash-preview-tts",
    name: "Gemini 2.5 Flash Preview TTS",
    provider: "google",
    inputPricePer1M: 0.5,
    outputPricePer1M: 10,
    contextWindow: 8192,
    maxOutputTokens: 16384,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    pricingTiers: [{ inputTokenThreshold: 200_000, inputPricePer1M: 2.5, outputPricePer1M: 15 }],
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    inputPricePer1M: 0.3,
    outputPricePer1M: 2.5,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "google",
    inputPricePer1M: 1.5,
    outputPricePer1M: 9,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemma-4-31b-it",
    name: "Gemma 4 31B IT",
    provider: "google",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-embedding-001",
    name: "Gemini Embedding 001",
    provider: "google",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0,
    contextWindow: 2048,
    maxOutputTokens: 1,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-3.1-pro-preview-customtools",
    name: "Gemini 3.1 Pro Preview Custom Tools",
    provider: "google",
    inputPricePer1M: 2,
    outputPricePer1M: 12,
    pricingTiers: [{ inputTokenThreshold: 200_000, inputPricePer1M: 4, outputPricePer1M: 18 }],
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-flash-lite-latest",
    name: "Gemini Flash-Lite Latest",
    provider: "google",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
    provider: "google",
    inputPricePer1M: 2,
    outputPricePer1M: 120,
    contextWindow: 131072,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image"],
    outputModalities: ["text", "image"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-2.5-flash-image",
    name: "Nano Banana",
    provider: "google",
    inputPricePer1M: 0.3,
    outputPricePer1M: 30,
    contextWindow: 32768,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image"],
    outputModalities: ["text", "image"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "google",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    provider: "google",
    inputPricePer1M: 0.5,
    outputPricePer1M: 60,
    contextWindow: 65536,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text", "image"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "google",
    inputPricePer1M: 2,
    outputPricePer1M: 12,
    pricingTiers: [{ inputTokenThreshold: 200_000, inputPricePer1M: 4, outputPricePer1M: 18 }],
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemma-4-26b-a4b-it",
    name: "Gemma 4 26B A4B IT",
    provider: "google",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview",
    provider: "google",
    inputPricePer1M: 2,
    outputPricePer1M: 12,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    inputPricePer1M: 0.5,
    outputPricePer1M: 3,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-2.5-pro-preview-tts",
    name: "Gemini 2.5 Pro Preview TTS",
    provider: "google",
    inputPricePer1M: 1,
    outputPricePer1M: 20,
    contextWindow: 8192,
    maxOutputTokens: 16384,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gemini-flash-latest",
    name: "Gemini Flash Latest",
    provider: "google",
    inputPricePer1M: 0.3,
    outputPricePer1M: 2.5,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite Preview",
    provider: "google",
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.5,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputModalities: ["text", "image", "video", "audio", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash-Lite",
    provider: "google",
    inputPricePer1M: 0.075,
    outputPricePer1M: 0.3,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image", "audio", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
];

const GOOGLE_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 60_000;

export class GoogleAdapter implements ProviderAdapter {
  name = "google";
  capabilities = googleCapabilities;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getApiUrl(model: string, stream: boolean): string {
    const endpoint = stream ? "streamGenerateContent" : "generateContent";
    const query = stream ? `alt=sse&key=${this.apiKey}` : `key=${this.apiKey}`;
    return `${GOOGLE_API_BASE_URL}/${model}:${endpoint}?${query}`;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const toolNames = new Map<string, string>();
    const contents: { role: string; parts: unknown[] }[] = [];
    for (const message of messages) {
      if (message.role === "system") continue;
      for (const toolCall of message.tool_calls ?? []) {
        toolNames.set(toolCall.id, toolCall.function.name);
      }
      const role = message.role === "assistant" ? "model" : "user";
      const parts = this.convertMessageParts(message, toolNames);
      const previous = contents.at(-1);
      if (message.role === "tool" && previous?.role === "user") {
        previous.parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }

    const systemInstruction = messages.find((m) => m.role === "system");

    return {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction.content }] }
        : undefined,
    };
  }

  private convertMessageParts(message: ChatMessage, toolNames: Map<string, string>): unknown[] {
    if (message.role === "tool") {
      return [
        {
          functionResponse: {
            name:
              message.name ??
              (message.tool_call_id ? toolNames.get(message.tool_call_id) : undefined) ??
              "",
            response: googleToolResult(contentToText(message.content)),
          },
        },
      ];
    }

    const parts = Array.isArray(message.content)
      ? message.content.map((part) => this.convertContentPart(part))
      : message.content == null
        ? []
        : [{ text: message.content }];

    if (message.tool_calls?.length) {
      parts.push(
        ...message.tool_calls.map((toolCall) => ({
          functionCall: {
            name: toolCall.function.name,
            args: safeJsonObject(toolCall.function.arguments),
          },
        })),
      );
    }

    return parts;
  }

  private convertContentPart(part: ChatContentPart): unknown {
    if (part.type === "text") return { text: part.text };
    if (part.type === "refusal") return { text: part.refusal };
    if (part.type === "image_url") {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      return inlineData ?? { fileData: { fileUri: part.image_url.url } };
    }
    if (part.type === "input_audio") {
      return {
        inlineData: {
          mimeType: `audio/${part.input_audio.format}`,
          data: part.input_audio.data,
        },
      };
    }
    if (part.type === "video_url") {
      const inlineData = dataUrlToInlineData(part.video_url.url);
      return inlineData ?? { fileData: { fileUri: part.video_url.url } };
    }
    return part.file.file_data
      ? {
          inlineData: {
            mimeType: "application/pdf",
            data: part.file.file_data,
          },
        }
      : { fileData: { fileUri: part.file.file_id ?? part.file.filename ?? "" } };
  }

  private buildRequestBody(request: ChatCompletionRequest, _stream: boolean): string {
    const converted = this.convertMessages(request.messages);
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    const maxOutputTokens = request.max_completion_tokens ?? request.max_tokens;
    if (maxOutputTokens !== undefined) generationConfig.maxOutputTokens = maxOutputTokens;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.stop !== undefined)
      generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    if (request.response_format?.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }
    if (request.response_format?.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = sanitizeGoogleResponseSchema(
        request.response_format.json_schema.schema,
      );
    }

    const body: Record<string, unknown> = {
      contents: converted.contents,
      generationConfig,
    };
    if (converted.systemInstruction) {
      body.systemInstruction = converted.systemInstruction;
    }
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters ?? { type: "object", properties: {} },
          })),
        },
      ];
    }
    if (request.tool_choice !== undefined) {
      body.toolConfig = toGoogleToolConfig(request.tool_choice);
    }
    return JSON.stringify(body);
  }

  private buildHeaders(options?: ProviderRequestOptions): Record<string, string> {
    return mergeProviderRequestHeaders(
      {
        "Content-Type": "application/json",
      },
      options,
    );
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getApiUrl(request.model, false), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? this.buildRequestBody(request, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError("Google", response);
    }

    const data = (await response.json()) as {
      id?: string;
      candidates?: {
        index?: number;
        content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] };
        finishReason?: string;
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const choices = (data.candidates ?? []).map((candidate, choiceIndex) => {
      const parts = candidate.content?.parts ?? [];
      const content = parts
        .filter((part): part is { text: string } => typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      const toolCalls = parts
        .filter((part): part is { functionCall: { name: string; args?: unknown } } =>
          Boolean(part.functionCall?.name),
        )
        .map(
          (part): ToolCall => ({
            id: createToolCallId(),
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          }),
        );

      return {
        index: candidate.index ?? choiceIndex,
        message: {
          role: "assistant",
          content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toOpenAIFinishReason(candidate.finishReason, toolCalls.length > 0),
      };
    });

    return {
      id: data.id ?? `google-${Date.now()}`,
      model: request.model,
      choices,
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async *chatCompletionStream(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(this.getApiUrl(request.model, true), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? this.buildRequestBody(request, true),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError("Google", response);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let messageId = `google-${Date.now()}`;
    let latestUsage: ChatCompletionChunk["usage"];
    const startedChoices = new Set<number>();
    const finishedChoices = new Set<number>();
    const choicesWithToolCalls = new Set<number>();
    const nextToolCallIndex = new Map<number, number>();

    function* processPayload(jsonText: string): Generator<ChatCompletionChunk> {
      if (!jsonText || jsonText === "[DONE]") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (err) {
        throw new SyntaxError(
          `Failed to parse Google stream chunk: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const chunks = Array.isArray(parsed) ? parsed : [parsed];
      for (const chunk of chunks) {
        const c = chunk as {
          id?: string;
          candidates?: {
            index?: number;
            content?: {
              parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[];
            };
            finishReason?: string;
          }[];
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        if (c.id) messageId = c.id;
        for (const [candidateIndex, candidate] of (c.candidates ?? []).entries()) {
          const choiceIndex = candidate.index ?? candidateIndex;
          if (!startedChoices.has(choiceIndex)) {
            startedChoices.add(choiceIndex);
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: choiceIndex,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            };
          }

          for (const part of candidate.content?.parts ?? []) {
            if (typeof part.text === "string") {
              yield {
                id: messageId,
                model: request.model,
                choices: [
                  {
                    index: choiceIndex,
                    delta: { content: part.text },
                    finish_reason: null,
                  },
                ],
              };
            }

            const functionCall = part.functionCall;
            if (functionCall?.name) {
              const toolIndex = nextToolCallIndex.get(choiceIndex) ?? 0;
              nextToolCallIndex.set(choiceIndex, toolIndex + 1);
              choicesWithToolCalls.add(choiceIndex);
              const toolCallId = createToolCallId();
              yield {
                id: messageId,
                model: request.model,
                choices: [
                  {
                    index: choiceIndex,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex,
                          id: toolCallId,
                          type: "function",
                          function: { name: functionCall.name, arguments: "" },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
              yield {
                id: messageId,
                model: request.model,
                choices: [
                  {
                    index: choiceIndex,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex,
                          function: {
                            arguments: JSON.stringify(functionCall.args ?? {}),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          }

          if (candidate.finishReason && !finishedChoices.has(choiceIndex)) {
            finishedChoices.add(choiceIndex);
            yield {
              id: messageId,
              model: request.model,
              choices: [
                {
                  index: choiceIndex,
                  delta: {},
                  finish_reason: toOpenAIFinishReason(
                    candidate.finishReason,
                    choicesWithToolCalls.has(choiceIndex),
                  ),
                },
              ],
            };
          }
        }
        if (c.usageMetadata) {
          latestUsage = {
            prompt_tokens: c.usageMetadata.promptTokenCount ?? 0,
            completion_tokens: c.usageMetadata.candidatesTokenCount ?? 0,
            total_tokens: c.usageMetadata.totalTokenCount ?? 0,
          };
        }
      }
    }

    const parser = new SseBlockParser();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        for (const block of parser.push(decoder.decode(value, { stream: true }))) {
          yield* processPayload(block.data);
        }
      }

      for (const block of [...parser.push(decoder.decode()), ...parser.end()]) {
        yield* processPayload(block.data);
      }
      for (const choiceIndex of startedChoices) {
        if (finishedChoices.has(choiceIndex)) continue;
        yield {
          id: messageId,
          model: request.model,
          choices: [
            {
              index: choiceIndex,
              delta: {},
              finish_reason: choicesWithToolCalls.has(choiceIndex) ? "tool_calls" : "stop",
            },
          ],
        };
      }
      if (latestUsage) {
        yield { id: messageId, model: request.model, choices: [], usage: latestUsage };
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The response body may already be closed or aborted.
      }
      reader.releaseLock();
    }
  }

  listModels(): Model[] {
    return MODELS;
  }
}

const maxGoogleSchemaSanitizationDepth = 5;

function sanitizeGoogleResponseSchema(schema: unknown, depth = 0): unknown {
  if (depth >= maxGoogleSchemaSanitizationDepth || !isJsonObject(schema)) {
    return schema;
  }

  const sanitized: Record<string, unknown> = { ...schema };
  delete sanitized.title;
  delete sanitized.$schema;

  if (sanitized.type === "object") {
    delete sanitized.additionalProperties;

    if (isJsonObject(sanitized.properties)) {
      sanitized.properties = Object.fromEntries(
        Object.entries(sanitized.properties).map(([name, propertySchema]) => [
          name,
          sanitizeGoogleResponseSchema(propertySchema, depth + 1),
        ]),
      );
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      if (Array.isArray(sanitized[keyword])) {
        sanitized[keyword] = sanitized[keyword].map((nestedSchema) =>
          sanitizeGoogleResponseSchema(nestedSchema, depth + 1),
        );
      }
    }
  } else if (sanitized.type === "array" && isJsonObject(sanitized.items)) {
    sanitized.items = sanitizeGoogleResponseSchema(sanitized.items, depth + 1);
  }

  return sanitized;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
      : { content: value };
  } catch {
    return { content: value };
  }
}

function googleToolResult(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return { result: parsed };
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Plain text tool results are wrapped below.
  }
  return { content: value };
}

function dataUrlToInlineData(
  url: string,
): { inlineData: { mimeType: string; data: string } } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { inlineData: { mimeType: match[1] ?? "image/png", data: match[2] ?? "" } };
}

function toGoogleToolConfig(toolChoice: ChatCompletionRequest["tool_choice"]): unknown {
  if (toolChoice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (toolChoice === "required") return { functionCallingConfig: { mode: "ANY" } };
  if (toolChoice === "auto") return { functionCallingConfig: { mode: "AUTO" } };
  if (toolChoice && typeof toolChoice === "object") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [toolChoice.function.name],
      },
    };
  }
  return undefined;
}

function toOpenAIFinishReason(reason: string | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls) return "tool_calls";
  if (reason === "MAX_TOKENS") return "length";
  if (
    reason === "SAFETY" ||
    reason === "RECITATION" ||
    reason === "BLOCKLIST" ||
    reason === "PROHIBITED_CONTENT" ||
    reason === "SPII" ||
    reason === "OTHER"
  ) {
    return "content_filter";
  }
  return "stop";
}
