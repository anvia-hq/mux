import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatContentPart,
  ChatMessage,
} from "../../../providers/types";

const IMAGE_TOKENS = 520;
const AUDIO_TOKENS = 256;
const FILE_TOKENS = 4_096;

function encodedLength(value: string): number {
  return value ? encode(value).length : 0;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function contentTokens(content: ChatMessage["content"]): number {
  if (typeof content === "string") return encodedLength(content);
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, part: ChatContentPart) => {
    if (part.type === "text") return total + encodedLength(part.text);
    if (part.type === "refusal") return total + encodedLength(part.refusal);
    if (part.type === "image_url") return total + IMAGE_TOKENS;
    if (part.type === "input_audio") return total + AUDIO_TOKENS;
    if (part.type === "file") return total + FILE_TOKENS;
    if (part.type === "video_url") return total + FILE_TOKENS;
    return total + FILE_TOKENS;
  }, 0);
}

export function estimateChatInputTokens(request: ChatCompletionRequest): number {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  let tokens = 3;

  for (const message of messages) {
    tokens += 3;
    tokens += encodedLength(message.role);
    tokens += contentTokens(message.content);
    if (message.name) tokens += encodedLength(message.name) + 3;
    if (message.tool_call_id) tokens += encodedLength(message.tool_call_id);
    if (message.tool_calls) tokens += encodedLength(safeJson(message.tool_calls));
  }

  if (request.tools) tokens += encodedLength(safeJson(request.tools)) + request.tools.length * 8;
  if (request.tool_choice !== undefined) tokens += encodedLength(safeJson(request.tool_choice));
  if (request.response_format !== undefined) {
    tokens += encodedLength(safeJson(request.response_format));
  }
  if (request.prefix !== undefined && request.prefix !== null) {
    tokens += encodedLength(
      typeof request.prefix === "string" ? request.prefix : safeJson(request.prefix),
    );
  }
  if (request.suffix !== undefined && request.suffix !== null) {
    tokens += encodedLength(
      typeof request.suffix === "string" ? request.suffix : safeJson(request.suffix),
    );
  }

  return Math.max(Math.ceil(tokens), 0);
}

export function requestedOutputTokenLimit(request: ChatCompletionRequest): number {
  const maxTokens = typeof request.max_tokens === "number" ? request.max_tokens : 0;
  const maxCompletionTokens =
    typeof request.max_completion_tokens === "number" ? request.max_completion_tokens : 0;
  return Math.max(maxTokens, maxCompletionTokens, 0);
}

export function estimateChatOutputTokens(response: ChatCompletionResponse): number {
  return response.choices.reduce((tokens, choice) => {
    const message = choice.message;
    return (
      tokens +
      3 +
      contentTokens(message.content) +
      (message.tool_calls ? encodedLength(safeJson(message.tool_calls)) : 0)
    );
  }, 0);
}

export function estimateChatChunkTokens(chunk: ChatCompletionChunk): number {
  return chunk.choices.reduce((tokens, choice) => {
    const delta = choice.delta as ChatCompletionChunk["choices"][number]["delta"] & {
      reasoning_content?: unknown;
    };
    let choiceTokens = typeof delta.content === "string" ? encodedLength(delta.content) : 0;
    if (typeof delta.reasoning_content === "string") {
      choiceTokens += encodedLength(delta.reasoning_content);
    }
    for (const toolCall of delta.tool_calls ?? []) {
      if (toolCall.id) choiceTokens += encodedLength(toolCall.id);
      if (toolCall.function?.name) choiceTokens += encodedLength(toolCall.function.name);
      if (toolCall.function?.arguments) {
        choiceTokens += encodedLength(toolCall.function.arguments);
      }
    }
    return tokens + choiceTokens;
  }, 0);
}
