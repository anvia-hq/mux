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
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
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
};

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
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
  metadata?: Record<string, string>;
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

export type ResponseCreateRequest = {
  model: string;
  input?: unknown;
  instructions?: string;
  stream?: boolean;
  background?: boolean;
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
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  type?: "provider" | "fallback-group";
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
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  createResponse?(request: ResponseCreateRequest): Promise<ResponseObject>;
  createResponseStream?(request: ResponseCreateRequest): AsyncIterable<string>;
  getResponse?(id: string, query?: Record<string, string | string[]>): Promise<ResponseObject>;
  deleteResponse?(id: string): Promise<ResponseObject>;
  listModels(): Model[];
}
