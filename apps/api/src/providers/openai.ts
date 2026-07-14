import type {
  AudioMultipartRequest,
  AudioProxyResponse,
  AudioProxyStreamResponse,
  AudioSpeechRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ProviderAdapter,
  Model,
  ModerationRequest,
  ModerationResponse,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
  ProviderRequestOptions,
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";
import {
  cloneFormDataWithModel,
  toAudioProxyResponse,
  toAudioProxyStreamResponse,
} from "./openai-compatible-audio";
import { throwOpenAICompatibleError } from "./openai-compatible-error";
import { throwResponsesApiError } from "./responses-api-error";
export { UpstreamResponsesApiError } from "./responses-api-error";
import { mergeProviderRequestHeaders } from "./types";
import {
  streamImageGenerationResponseBody,
  streamTextResponseBody,
} from "./openai-compatible-stream";

const MODELS: Model[] = [
  {
    id: "o3",
    name: "o3",
    provider: "openai",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "text-embedding-3-large",
    name: "text-embedding-3-large",
    provider: "openai",
    inputPricePer1M: 0.13,
    outputPricePer1M: 0,
    contextWindow: 8191,
    maxOutputTokens: 3072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "whisper-1",
    name: "whisper-1",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["audio"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-transcribe",
    name: "gpt-4o-transcribe",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["audio"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-mini-transcribe",
    name: "gpt-4o-mini-transcribe",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["audio"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-mini-transcribe-2025-12-15",
    name: "gpt-4o-mini-transcribe-2025-12-15",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["audio"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-transcribe-diarize",
    name: "gpt-4o-transcribe-diarize",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["audio"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "tts-1",
    name: "tts-1",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "tts-1-hd",
    name: "tts-1-hd",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-mini-tts",
    name: "gpt-4o-mini-tts",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-mini-tts-2025-12-15",
    name: "gpt-4o-mini-tts-2025-12-15",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["audio"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "text-moderation-latest",
    name: "text-moderation-latest",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 32768,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["moderation"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "text-moderation-stable",
    name: "text-moderation-stable",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 32768,
    maxOutputTokens: 0,
    inputModalities: ["text"],
    outputModalities: ["moderation"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "omni-moderation-latest",
    name: "omni-moderation-latest",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 32768,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["moderation"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-3.5-turbo-instruct",
    name: "GPT-3.5 Turbo Instruct",
    provider: "openai",
    inputPricePer1M: 1.5,
    outputPricePer1M: 2,
    contextWindow: 4096,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "davinci-002",
    name: "davinci-002",
    provider: "openai",
    inputPricePer1M: 2,
    outputPricePer1M: 2,
    contextWindow: 16384,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "babbage-002",
    name: "babbage-002",
    provider: "openai",
    inputPricePer1M: 0.4,
    outputPricePer1M: 0.4,
    contextWindow: 16384,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5.2-pro",
    name: "GPT-5.2 Pro",
    provider: "openai",
    inputPricePer1M: 21,
    outputPricePer1M: 168,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5-turbo",
    provider: "openai",
    inputPricePer1M: 0.5,
    outputPricePer1M: 1.5,
    contextWindow: 16385,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5-pro",
    name: "GPT-5 Pro",
    provider: "openai",
    inputPricePer1M: 15,
    outputPricePer1M: 120,
    contextWindow: 400000,
    maxOutputTokens: 272000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    inputPricePer1M: 2.5,
    outputPricePer1M: 10,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4",
    name: "GPT-4",
    provider: "openai",
    inputPricePer1M: 30,
    outputPricePer1M: 60,
    contextWindow: 8192,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    provider: "openai",
    inputPricePer1M: 1.1,
    outputPricePer1M: 4.4,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "o3-pro",
    name: "o3-pro",
    provider: "openai",
    inputPricePer1M: 20,
    outputPricePer1M: 80,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "chatgpt-image-latest",
    name: "chatgpt-image-latest",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["text", "image"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4o-2024-05-13",
    name: "GPT-4o (2024-05-13)",
    provider: "openai",
    inputPricePer1M: 5,
    outputPricePer1M: 15,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 nano",
    provider: "openai",
    inputPricePer1M: 0.2,
    outputPricePer1M: 1.25,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5-chat-latest",
    name: "GPT-5 Chat (latest)",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: false,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.3-chat-latest",
    name: "GPT-5.3 Chat (latest)",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4o-2024-08-06",
    name: "GPT-4o (2024-08-06)",
    provider: "openai",
    inputPricePer1M: 2.5,
    outputPricePer1M: 10,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "text-embedding-ada-002",
    name: "text-embedding-ada-002",
    provider: "openai",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0,
    contextWindow: 8192,
    maxOutputTokens: 1536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    provider: "openai",
    inputPricePer1M: 1.1,
    outputPricePer1M: 4.4,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "text-embedding-3-small",
    name: "text-embedding-3-small",
    provider: "openai",
    inputPricePer1M: 0.02,
    outputPricePer1M: 0,
    contextWindow: 8191,
    maxOutputTokens: 1536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex mini",
    provider: "openai",
    inputPricePer1M: 0.25,
    outputPricePer1M: 2,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.1-chat-latest",
    name: "GPT-5.1 Chat",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.2-chat-latest",
    name: "GPT-5.2 Chat",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "o4-mini-deep-research",
    name: "o4-mini-deep-research",
    provider: "openai",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-image-1.5",
    name: "gpt-image-1.5",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["text", "image"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 nano",
    provider: "openai",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4o-2024-11-20",
    name: "GPT-4o (2024-11-20)",
    provider: "openai",
    inputPricePer1M: 2.5,
    outputPricePer1M: 10,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "o1",
    name: "o1",
    provider: "openai",
    inputPricePer1M: 15,
    outputPricePer1M: 60,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "o1-pro",
    name: "o1-pro",
    provider: "openai",
    inputPricePer1M: 150,
    outputPricePer1M: 600,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    inputPricePer1M: 2.5,
    outputPricePer1M: 15,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    provider: "openai",
    inputPricePer1M: 0.75,
    outputPricePer1M: 4.5,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "o3-deep-research",
    name: "o3-deep-research",
    provider: "openai",
    inputPricePer1M: 10,
    outputPricePer1M: 40,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "openai",
    inputPricePer1M: 0.25,
    outputPricePer1M: 2,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-image-1",
    name: "gpt-image-1",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["image"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    provider: "openai",
    inputPricePer1M: 0.4,
    outputPricePer1M: 1.6,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
    inputPricePer1M: 10,
    outputPricePer1M: 30,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-image-1-mini",
    name: "gpt-image-1-mini",
    provider: "openai",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["text", "image"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    inputPricePer1M: 0.05,
    outputPricePer1M: 0.4,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    provider: "openai",
    inputPricePer1M: 30,
    outputPricePer1M: 180,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    provider: "openai",
    inputPricePer1M: 30,
    outputPricePer1M: 180,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5-codex",
    name: "GPT-5-Codex",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-image-2",
    name: "gpt-image-2",
    provider: "openai",
    inputPricePer1M: 5,
    outputPricePer1M: 30,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ["text", "image"],
    outputModalities: ["image"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    inputPricePer1M: 5,
    outputPricePer1M: 30,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
];

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";
const OPENAI_IMAGE_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/completions";
const OPENAI_AUDIO_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_AUDIO_TRANSLATIONS_URL = "https://api.openai.com/v1/audio/translations";
const OPENAI_AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const REQUEST_TIMEOUT_MS = 60_000;

export type UpstreamResponsesQuery = Record<string, string | string[]>;

function buildResponsesUrl(id: string, query?: UpstreamResponsesQuery): string {
  return buildResponsesSubResourceUrl(id, undefined, query);
}

function buildResponsesSubResourceUrl(
  id: string,
  suffix: string | undefined,
  query?: UpstreamResponsesQuery,
): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else if (value !== undefined) {
        params.append(key, value);
      }
    }
  }
  const qs = params.toString();
  const tail = suffix ? `/${suffix}` : "";
  return `${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}${tail}${qs ? `?${qs}` : ""}`;
}

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  capabilities = { ...openAICompatibleCapabilities, responsesTransport: "native" as const };
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? this.buildRequestBody(request, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? this.buildRequestBody(request, true),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
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

  async createEmbedding(
    request: EmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<EmbeddingResponse> {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as EmbeddingResponse;
  }

  async createModeration(
    request: ModerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ModerationResponse> {
    const response = await fetch(OPENAI_MODERATIONS_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return (await response.json()) as ModerationResponse;
  }

  async createImageGeneration(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ImageGenerationResponse> {
    const response = await fetch(OPENAI_IMAGE_GENERATIONS_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return (await response.json()) as ImageGenerationResponse;
  }

  async *createImageGenerationStream(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(OPENAI_IMAGE_GENERATIONS_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    yield* streamImageGenerationResponseBody(response);
  }

  async createCompletion(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<CompletionResponse> {
    const response = await fetch(OPENAI_COMPLETIONS_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return (await response.json()) as CompletionResponse;
  }

  async *createCompletionStream(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    yield* this.createRawStream(OPENAI_COMPLETIONS_URL, { ...request, stream: true }, options);
  }

  async createAudioTranscription(request: AudioMultipartRequest): Promise<AudioProxyResponse> {
    return this.createAudioMultipart(OPENAI_AUDIO_TRANSCRIPTIONS_URL, request);
  }

  async createAudioTranscriptionStream(
    request: AudioMultipartRequest,
  ): Promise<AudioProxyStreamResponse> {
    return this.createAudioMultipartStream(OPENAI_AUDIO_TRANSCRIPTIONS_URL, request);
  }

  async createAudioTranslation(request: AudioMultipartRequest): Promise<AudioProxyResponse> {
    return this.createAudioMultipart(OPENAI_AUDIO_TRANSLATIONS_URL, request);
  }

  async createAudioSpeech(request: AudioSpeechRequest): Promise<AudioProxyResponse> {
    const response = await fetch(OPENAI_AUDIO_SPEECH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return toAudioProxyResponse(response);
  }

  async createAudioSpeechStream(request: AudioSpeechRequest): Promise<AudioProxyStreamResponse> {
    const response = await fetch(OPENAI_AUDIO_SPEECH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return toAudioProxyStreamResponse(response);
  }

  async createResponse(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async *createResponseStream(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    yield* streamTextResponseBody(response);
  }

  async getResponse(
    id: string,
    query?: UpstreamResponsesQuery,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(buildResponsesUrl(id, query), {
      method: "GET",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async deleteResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async cancelResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async compactResponse(
    request: ResponseCompactRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(`${OPENAI_RESPONSES_URL}/compact`, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async countResponseInputTokens(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(`${OPENAI_RESPONSES_URL}/input_tokens`, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  async listResponseInputItems(
    id: string,
    query?: UpstreamResponsesQuery,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(buildResponsesSubResourceUrl(id, "input_items", query), {
      method: "GET",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError("OpenAI", response);
    }

    return (await response.json()) as ResponseObject;
  }

  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    return buildOpenAICompatibleRequestBody(request, stream);
  }

  private buildHeaders(
    options: ProviderRequestOptions | undefined,
    includeContentType: boolean,
  ): Record<string, string> {
    return mergeProviderRequestHeaders(
      {
        ...(includeContentType ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${this.apiKey}`,
      },
      options,
    );
  }

  private async *createRawStream(
    url: string,
    request: Record<string, unknown>,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(options, true),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    yield* streamTextResponseBody(response);
  }

  private async createAudioMultipart(
    url: string,
    request: AudioMultipartRequest,
  ): Promise<AudioProxyResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: cloneFormDataWithModel(request.formData, request.model),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return toAudioProxyResponse(response);
  }

  private async createAudioMultipartStream(
    url: string,
    request: AudioMultipartRequest,
  ): Promise<AudioProxyStreamResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: cloneFormDataWithModel(request.formData, request.model),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError("OpenAI", response);
    }

    return toAudioProxyStreamResponse(response);
  }

  listModels(): Model[] {
    return MODELS;
  }
}
