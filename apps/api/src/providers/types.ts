export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "refusal"; refusal: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { file_id?: string; filename?: string; file_data?: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

export interface ChatMessage {
  role: string;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  [key: string]: unknown;
}

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
};

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export type ChatResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean;
      };
    };

export type ChatAudioOptions = {
  voice: string;
  format: "wav" | "mp3" | "flac" | "opus" | "pcm16";
};

export type ChatStreamOptions = {
  include_usage?: boolean;
  [key: string]: unknown;
};

export interface ChatCompletionRequest {
  [key: string]: unknown;
  model: string;
  messages: ChatMessage[];
  prefix?: unknown;
  suffix?: unknown;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: ChatResponseFormat;
  top_p?: number;
  stop?: string | string[];
  n?: number;
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  user?: string;
  metadata?: Record<string, unknown>;
  store?: boolean;
  service_tier?: "auto" | "default" | "flex";
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  modalities?: ("text" | "audio")[];
  audio?: ChatAudioOptions;
  stream_options?: ChatStreamOptions;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
    logprobs?: unknown;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: ChatMessage["role"];
      content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason: string | null;
    logprobs?: unknown;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type EmbeddingInput = string | string[] | number[] | number[][];

export interface EmbeddingRequest {
  model: string;
  input: EmbeddingInput;
  encoding_format?: "float" | "base64";
  dimensions?: number;
  user?: string;
  [key: string]: unknown;
}

export interface EmbeddingResponse {
  object: "list";
  data: {
    object: "embedding";
    embedding: number[] | string;
    index: number;
  }[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export type ModerationInput =
  | string
  | string[]
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    >;

export interface ModerationRequest {
  model?: string;
  input: ModerationInput;
  [key: string]: unknown;
}

export interface ModerationResponse {
  id?: string;
  model?: string;
  results?: unknown[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: "url" | "b64_json";
  style?: string;
  user?: string;
  background?: string;
  moderation?: string;
  output_format?: string;
  output_compression?: number;
  partial_images?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ImageGenerationResponse {
  created?: number;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    [key: string]: unknown;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type CompletionPrompt = string | string[] | number[] | number[][];

export interface CompletionRequest {
  model: string;
  prompt: CompletionPrompt;
  stream?: boolean;
  suffix?: string | null;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stop?: string | string[];
  stream_options?: ChatStreamOptions;
  logprobs?: number;
  echo?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  seed?: number;
  [key: string]: unknown;
}

export interface CompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    text?: string;
    index?: number;
    logprobs?: unknown;
    finish_reason?: string | null;
    [key: string]: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AudioMultipartRequest {
  model: string;
  formData: FormData;
}

export interface AudioSpeechRequest {
  model: string;
  input: string;
  voice: string | { id: string };
  instructions?: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
  stream_format?: "audio" | "sse";
  [key: string]: unknown;
}

export interface AudioProxyResponse {
  body: ArrayBuffer;
  contentType?: string;
  usage?: Record<string, unknown>;
}

export type AudioProxyStreamChunk = string | Uint8Array;

export interface AudioProxyStreamResponse {
  stream: AsyncIterable<AudioProxyStreamChunk>;
  contentType?: string;
}

export type ResponseCreateRequest = {
  model: string;
  input?: unknown;
  instructions?: string;
  stream?: boolean;
  background?: boolean;
  [key: string]: unknown;
};

export type ResponseCompactRequest = {
  model: string;
  input?: unknown;
  [key: string]: unknown;
};

export type ResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
};

export type ResponseObject = {
  id?: string;
  model?: string;
  usage?: ResponseUsage;
  [key: string]: unknown;
};

export type AnthropicMessageCreateRequest = {
  model: string;
  messages: unknown[];
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
};

export type AnthropicMessageCountTokensRequest = {
  model: string;
  messages: unknown[];
  [key: string]: unknown;
};

export type AnthropicMessageObject = {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type AnthropicMessageTokenCountObject = {
  input_tokens?: number;
  [key: string]: unknown;
};

export {
  type ResponseInputItem,
  type ResponseInputMessage,
  type ResponseInputTextParam,
  type ResponseReferenceItemParam,
  type ResponseOutputItem,
  type ResponseOutputMessage,
  type ResponseOutputText,
  type ResponseOutputRefusal,
  type ResponseFunctionToolCall,
  type ResponseUsage as ResponseUsageDetailed,
  type ResponseObject as ResponseObjectDetailed,
  assertNever,
} from "./responses-types";

export interface ProviderCapabilities {
  tools: boolean;
  structuredOutput: boolean;
  multimodalInput: boolean;
  audioOutput: boolean;
  reasoning: boolean;
  logprobs: boolean;
  openAICompatiblePassthrough: boolean;
  /**
   * Whether this adapter implements the OpenAI Responses API surface
   * (`createResponse`, `createResponseStream`, `getResponse`,
   * `deleteResponse`). Used by the `/v1/responses` router to decide
   * which targets a model id (or fallback group) can resolve to.
   * Defaults to `false`; opt in per adapter.
   */
  responsesApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible embeddings through
   * `/v1/embeddings`.
   */
  embeddingsApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible moderation requests
   * through `/v1/moderations`.
   */
  moderationsApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible image generation
   * requests through `/v1/images/generations`.
   */
  imageGenerationsApi?: boolean;
  /**
   * Whether this adapter can proxy the legacy OpenAI-compatible completions
   * API through `/v1/completions`.
   */
  completionsApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible audio transcriptions
   * through `/v1/audio/transcriptions`.
   */
  audioTranscriptionsApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible audio translations
   * through `/v1/audio/translations`.
   */
  audioTranslationsApi?: boolean;
  /**
   * Whether this adapter can proxy OpenAI-compatible speech generation
   * through `/v1/audio/speech`.
   */
  audioSpeechApi?: boolean;
  /**
   * Whether this adapter can proxy Anthropic-compatible native Messages API
   * requests through `/v1/messages`.
   */
  anthropicMessagesApi?: boolean;
  /**
   * Whether this adapter can proxy Anthropic-compatible token counting
   * requests through `/v1/messages/count_tokens`.
   */
  anthropicMessageTokenCountingApi?: boolean;
}

export type ProviderRequestOptions = {
  headers?: Record<string, string>;
  rawBody?: string;
};

export function mergeProviderRequestHeaders(
  baseHeaders: Record<string, string>,
  options?: ProviderRequestOptions,
): Record<string, string> {
  const headers = { ...baseHeaders };
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) continue;

    for (const existingKey of Object.keys(headers)) {
      if (existingKey.toLowerCase() === trimmedKey.toLowerCase()) {
        delete headers[existingKey];
      }
    }
    headers[trimmedKey] = trimmedValue;
  }
  return headers;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  type?: "provider" | "fallback-group" | "alias";
  /** Price per 1M input (prompt) tokens in USD. */
  inputPricePer1M: number;
  /** Price per 1M output (completion) tokens in USD. */
  outputPricePer1M: number;
  /** Total context window in tokens. */
  contextWindow: number;
  /** Maximum output tokens. */
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  weights: "open" | "closed";
  fallbackTargets?: {
    provider: string;
    modelId: string;
    publicModelId: string;
    position: number;
  }[];
  aliasTargetModelId?: string;
}

/** Sensible defaults for most modern chat models. Override as needed. */
export const modelDefaults = {
  inputModalities: ["text"],
  outputModalities: ["text"],
  reasoning: true,
  toolCall: true,
  structuredOutput: true,
  weights: "closed" as const,
};

export const visionInput = { inputModalities: ["text", "image"] };
export const imageOutput = { outputModalities: ["image"] };
export const audioInput = { inputModalities: ["text", "image", "audio"] };
export const audioVideoInput = { inputModalities: ["text", "image", "audio", "video"] };
export const pdfInput = { inputModalities: ["text", "image", "pdf"] };
export const textOnly = { inputModalities: ["text"], outputModalities: ["text"] };

export interface ProviderAdapter {
  name: string;
  capabilities: ProviderCapabilities;
  chatCompletion(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<ChatCompletionChunk>;
  createEmbedding?(
    request: EmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<EmbeddingResponse>;
  createModeration?(
    request: ModerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ModerationResponse>;
  createImageGeneration?(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ImageGenerationResponse>;
  createImageGenerationStream?(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string>;
  createCompletion?(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<CompletionResponse>;
  createCompletionStream?(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string>;
  createAudioTranscription?(request: AudioMultipartRequest): Promise<AudioProxyResponse>;
  createAudioTranscriptionStream?(
    request: AudioMultipartRequest,
  ): Promise<AudioProxyStreamResponse>;
  createAudioTranslation?(request: AudioMultipartRequest): Promise<AudioProxyResponse>;
  createAudioSpeech?(request: AudioSpeechRequest): Promise<AudioProxyResponse>;
  createAudioSpeechStream?(request: AudioSpeechRequest): Promise<AudioProxyStreamResponse>;
  createResponse?(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject>;
  createResponseStream?(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string>;
  getResponse?(
    id: string,
    query?: Record<string, string | string[]>,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject>;
  deleteResponse?(id: string, options?: ProviderRequestOptions): Promise<ResponseObject>;
  cancelResponse?(id: string, options?: ProviderRequestOptions): Promise<ResponseObject>;
  compactResponse?(
    request: ResponseCompactRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject>;
  countResponseInputTokens?(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject>;
  listResponseInputItems?(
    id: string,
    query?: Record<string, string | string[]>,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject>;
  createAnthropicMessage?(
    request: AnthropicMessageCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<AnthropicMessageObject>;
  createAnthropicMessageStream?(
    request: AnthropicMessageCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string>;
  countAnthropicMessageTokens?(
    request: AnthropicMessageCountTokensRequest,
    options?: ProviderRequestOptions,
  ): Promise<AnthropicMessageTokenCountObject>;
  listModels(): Model[];
}
