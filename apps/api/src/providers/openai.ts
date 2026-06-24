import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
  ResponseCreateRequest,
  ResponseObject,
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";

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
const REQUEST_TIMEOUT_MS = 60_000;

export class UpstreamResponsesApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenAI Responses API error: ${status} - ${body}`);
    this.name = "UpstreamResponsesApiError";
    this.status = status;
    this.body = body;
  }

  get jsonError(): {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string | null;
  } | null {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        return parsed.error as {
          message?: string;
          type?: string;
          param?: string | null;
          code?: string | null;
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

export type UpstreamResponsesQuery = Record<string, string | string[]>;

function buildResponsesUrl(id: string, query?: UpstreamResponsesQuery): string {
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
  return `${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
}

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  capabilities = openAICompatibleCapabilities;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildRequestBody(request, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildRequestBody(request, true),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
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

  async createResponse(request: ResponseCreateRequest): Promise<ResponseObject> {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new UpstreamResponsesApiError(response.status, error);
    }

    return (await response.json()) as ResponseObject;
  }

  async *createResponseStream(request: ResponseCreateRequest): AsyncIterable<string> {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new UpstreamResponsesApiError(response.status, error);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }

    const final = decoder.decode();
    if (final) yield final;
  }

  async getResponse(id: string, query?: UpstreamResponsesQuery): Promise<ResponseObject> {
    const response = await fetch(buildResponsesUrl(id, query), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new UpstreamResponsesApiError(response.status, error);
    }

    return (await response.json()) as ResponseObject;
  }

  async deleteResponse(id: string): Promise<ResponseObject> {
    const response = await fetch(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new UpstreamResponsesApiError(response.status, error);
    }

    return (await response.json()) as ResponseObject;
  }

  async cancelResponse(id: string): Promise<ResponseObject> {
    const response = await fetch(
      `${OPENAI_RESPONSES_URL}/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new UpstreamResponsesApiError(response.status, error);
    }

    return (await response.json()) as ResponseObject;
  }

  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    return buildOpenAICompatibleRequestBody(request, stream);
  }

  listModels(): Model[] {
    return MODELS;
  }
}
