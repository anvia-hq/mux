import { openAICompatibleCapabilities } from "./chat-compat";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  Model,
  ProviderAdapter,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
} from "./types";

export const E2E_CHAT_MODEL = "e2e-chat";
export const E2E_BACKUP_MODEL = "e2e-backup";
export const E2E_FAIL_MODEL = "e2e-fail";
export const E2E_RESPONSES_MODEL = "e2e-responses";
export const E2E_UNBILLABLE_MODEL = "e2e-unbillable";

const E2E_PROVIDER = "e2e";
const CHAT_USAGE = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
const RESPONSE_USAGE = {
  input_tokens: 12,
  output_tokens: 8,
  total_tokens: 20,
  output_tokens_details: { reasoning_tokens: 1 },
};

const MODELS: Model[] = [
  model(E2E_CHAT_MODEL, "E2E Chat"),
  model(E2E_BACKUP_MODEL, "E2E Backup"),
  model(E2E_FAIL_MODEL, "E2E Forced Failure"),
  model(E2E_RESPONSES_MODEL, "E2E Responses"),
  model(E2E_UNBILLABLE_MODEL, "E2E Unbillable"),
  {
    ...model("e2e-unsupported", "E2E Unsupported"),
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
  },
];

export class E2eAdapter implements ProviderAdapter {
  readonly name = E2E_PROVIDER;
  readonly capabilities = openAICompatibleCapabilities;

  constructor(readonly apiKey: string) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    assertNotForcedFailure(request.model);

    return {
      id: e2eId("chatcmpl"),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: `E2E response for ${readChatPrompt(request)}`,
          },
          finish_reason: "stop",
        },
      ],
      usage: request.model === E2E_UNBILLABLE_MODEL ? zeroChatUsage() : CHAT_USAGE,
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    assertNotForcedFailure(request.model);

    const id = e2eId("chatcmpl");
    yield {
      id,
      model: request.model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    };
    yield {
      id,
      model: request.model,
      choices: [
        {
          index: 0,
          delta: { content: `E2E stream for ${readChatPrompt(request)}` },
          finish_reason: null,
        },
      ],
    };
    yield {
      id,
      model: request.model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: CHAT_USAGE,
    };
  }

  async createResponse(request: ResponseCreateRequest): Promise<ResponseObject> {
    assertNotForcedFailure(request.model);
    const status = request.background === true ? "queued" : "completed";
    return responseObject({
      id: e2eId(request.background === true ? "resp_bg" : "resp"),
      model: request.model,
      status,
      text: `E2E response for ${readResponseInput(request.input)}`,
      usage: status === "completed" ? RESPONSE_USAGE : undefined,
    });
  }

  async *createResponseStream(request: ResponseCreateRequest): AsyncIterable<string> {
    assertNotForcedFailure(request.model);
    const response = responseObject({
      id: e2eId("resp_stream"),
      model: request.model,
      status: "in_progress",
      text: "",
    });

    yield sse("response.created", { type: "response.created", response });
    yield sse("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: `E2E stream for ${readResponseInput(request.input)}`,
    });
    yield sse("response.completed", {
      type: "response.completed",
      response: responseObject({
        ...response,
        status: "completed",
        text: `E2E stream for ${readResponseInput(request.input)}`,
        usage: RESPONSE_USAGE,
      }),
    });
  }

  async getResponse(id: string): Promise<ResponseObject> {
    return responseObject({
      id,
      model: E2E_RESPONSES_MODEL,
      status: "completed",
      text: "E2E retrieved response",
      usage: RESPONSE_USAGE,
    });
  }

  async deleteResponse(id: string): Promise<ResponseObject> {
    return { id, object: "response", deleted: true };
  }

  async cancelResponse(id: string): Promise<ResponseObject> {
    return responseObject({
      id,
      model: E2E_RESPONSES_MODEL,
      status: "cancelled",
      text: "E2E cancelled response",
    });
  }

  async compactResponse(request: ResponseCompactRequest): Promise<ResponseObject> {
    return responseObject({
      id: e2eId("resp_compact"),
      model: request.model,
      status: "completed",
      text: "E2E compacted context",
      usage: RESPONSE_USAGE,
    });
  }

  async countResponseInputTokens(request: ResponseCreateRequest): Promise<ResponseObject> {
    return {
      object: "response.input_tokens",
      model: request.model,
      input_tokens: 42,
      usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 },
    };
  }

  async listResponseInputItems(id: string): Promise<ResponseObject> {
    return {
      object: "list",
      data: [
        {
          id: `${id}_item_0`,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "E2E input item" }],
        },
      ],
      first_id: `${id}_item_0`,
      last_id: `${id}_item_0`,
      has_more: false,
    };
  }

  listModels(): Model[] {
    return MODELS;
  }
}

function model(id: string, name: string): Model {
  return {
    id,
    name,
    provider: E2E_PROVIDER,
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  };
}

function assertNotForcedFailure(modelId: string): void {
  if (modelId === E2E_FAIL_MODEL) {
    throw new Error("E2E provider forced failure");
  }
}

function zeroChatUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function readChatPrompt(request: ChatCompletionRequest): string {
  const message = [...request.messages].reverse().find((item) => item.role === "user");
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find((part) => part.type === "text");
    return text?.type === "text" ? text.text : "input";
  }
  return "input";
}

function readResponseInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    const first = input[0] as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const text = first?.content?.find((part) => part.type === "input_text")?.text;
    if (text) return text;
  }
  return "input";
}

function responseObject(input: {
  id?: string;
  model?: string;
  status?: string;
  text?: string;
  usage?: ResponseObject["usage"];
}): ResponseObject {
  return {
    id: input.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: input.model,
    status: input.status,
    output: [
      {
        id: e2eId("msg"),
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: input.text ?? "", annotations: [] }],
      },
    ],
    usage: input.usage,
  };
}

function sse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function e2eId(prefix: string): string {
  return `${prefix}_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
