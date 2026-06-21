export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
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
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  listModels(): Model[];
}
