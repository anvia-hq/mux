import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
  ChatContentPart,
  ChatMessage,
  ToolCall,
} from "./types";
import { googleCapabilities } from "./chat-compat";

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
    return `${GOOGLE_API_BASE_URL}/${model}:${endpoint}?key=${this.apiKey}`;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: this.convertMessageParts(m),
      }));

    const systemInstruction = messages.find((m) => m.role === "system");

    return {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction.content }] }
        : undefined,
    };
  }

  private convertMessageParts(message: ChatMessage): unknown[] {
    if (message.role === "tool") {
      return [
        {
          functionResponse: {
            name: message.name ?? message.tool_call_id ?? "tool",
            response: safeJsonObject(contentToText(message.content)),
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
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.stop !== undefined)
      generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    if (request.response_format?.type === "json_object") {
      generationConfig.responseMimeType = "application/json";
    }
    if (request.response_format?.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = request.response_format.json_schema.schema;
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

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getApiUrl(request.model, false), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      id?: string;
      candidates?: {
        content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] };
        finishReason?: string;
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const content = parts
      .filter((part): part is { text: string } => typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    const toolCalls = parts
      .filter(
        (part): part is { functionCall: { name: string; args?: unknown } } =>
          Boolean(part.functionCall?.name),
      )
      .map(
        (part, index): ToolCall => ({
          id: `call_${index}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          },
        }),
      );

    return {
      id: data.id ?? `google-${Date.now()}`,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: toolCalls.length > 0 ? "tool_calls" : candidate?.finishReason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(this.getApiUrl(request.model, true), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // Google streams JSON objects (each chunk is a separate JSON object, sometimes wrapped in arrays).
    // Extract each complete top-level JSON object from the buffer and yield it.
    function* processBuffer(): Generator<ChatCompletionChunk> {
      while (buffer.length > 0) {
        const trimmed = buffer.trimStart();
        if (trimmed.length === 0) {
          buffer = "";
          break;
        }

        const ch = trimmed[0];
        if (ch !== "[" && ch !== "{") {
          // Unexpected leading character; drop it to avoid infinite loop
          buffer = trimmed.slice(1);
          continue;
        }

        // Find the matching closing bracket while respecting string nesting.
        let depth = 0;
        let inString = false;
        let escaped = false;
        let closeIdx = -1;
        for (let i = 0; i < trimmed.length; i++) {
          const c = trimmed[i];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (c === "\\") {
              escaped = true;
            } else if (c === '"') {
              inString = false;
            }
            continue;
          }
          if (c === '"') {
            inString = true;
          } else if (c === "{" || c === "[") {
            depth++;
          } else if (c === "}" || c === "]") {
            depth--;
            if (depth === 0) {
              closeIdx = i;
              break;
            }
          }
        }

        if (closeIdx === -1) {
          // Incomplete JSON; wait for more data
          buffer = trimmed;
          break;
        }

        const jsonText = trimmed.slice(0, closeIdx + 1);
        buffer = trimmed.slice(closeIdx + 1);

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch (err) {
          // Skip non-fatal parse failures to keep the stream alive on a bad chunk
          console.warn(
            `Failed to parse Google stream chunk, skipping: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }

        const chunks = Array.isArray(parsed) ? parsed : [parsed];
        for (const chunk of chunks) {
          const c = chunk as {
            id?: string;
            candidates?: {
              content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] };
              finishReason?: string;
            }[];
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          };
          const candidate = c.candidates?.[0];
          const text = candidate?.content?.parts?.find((part) => typeof part.text === "string")
            ?.text;
          if (text !== undefined) {
            yield {
              id: c.id ?? `google-${Date.now()}`,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: text },
                  finish_reason: candidate?.finishReason ?? null,
                },
              ],
            };
          }
          const functionCall = candidate?.content?.parts?.find((part) => part.functionCall)
            ?.functionCall;
          if (functionCall?.name) {
            yield {
              id: c.id ?? `google-${Date.now()}`,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_0",
                        type: "function",
                        function: {
                          name: functionCall.name,
                          arguments: JSON.stringify(functionCall.args ?? {}),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            };
          }
          if (c.usageMetadata) {
            yield {
              id: c.id ?? `google-${Date.now()}`,
              model: request.model,
              choices: [],
              usage: {
                prompt_tokens: c.usageMetadata.promptTokenCount ?? 0,
                completion_tokens: c.usageMetadata.candidatesTokenCount ?? 0,
                total_tokens: c.usageMetadata.totalTokenCount ?? 0,
              },
            };
          }
        }
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      yield* processBuffer();
    }

    // Flush any remaining bytes from the decoder and process any trailing JSON
    buffer += decoder.decode();
    yield* processBuffer();
  }

  listModels(): Model[] {
    return MODELS;
  }
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

function dataUrlToInlineData(url: string): { inlineData: { mimeType: string; data: string } } | null {
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
