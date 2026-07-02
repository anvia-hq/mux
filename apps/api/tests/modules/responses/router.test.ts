import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleResponseCancel,
  mockHandleResponseCompact,
  mockHandleResponseCreate,
  mockHandleResponseCreateStream,
  mockHandleResponseDelete,
  mockHandleResponseInputItems,
  mockHandleResponseInputTokens,
  mockHandleResponseRetrieve,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockSpendLimit,
  mockSubmitBackgroundResponse,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleResponseCancel: vi.fn(),
  mockHandleResponseCompact: vi.fn(),
  mockHandleResponseCreate: vi.fn(),
  mockHandleResponseCreateStream: vi.fn(),
  mockHandleResponseDelete: vi.fn(),
  mockHandleResponseInputItems: vi.fn(),
  mockHandleResponseInputTokens: vi.fn(),
  mockHandleResponseRetrieve: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
  mockSubmitBackgroundResponse: vi.fn(),
}));

vi.mock("../../../src/modules/responses/services", () => {
  class UnsupportedResponseFeatureError extends Error {
    constructor(message = "Responses API is not supported") {
      super(message);
      this.name = "UnsupportedResponseFeatureError";
    }
  }

  class ApiKeyUnbillableResponseUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this response request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableResponseUsageError";
    }
  }

  class OpenAIResponseProviderNotConfiguredError extends Error {
    constructor() {
      super("OpenAI provider is not configured");
      this.name = "OpenAIResponseProviderNotConfiguredError";
    }
  }

  class ResponseNotFoundError extends Error {
    constructor(id: string) {
      super(`Response not found: ${id}`);
      this.name = "ResponseNotFoundError";
    }
  }

  return {
    ApiKeyUnbillableResponseUsageError,
    OpenAIResponseProviderNotConfiguredError,
    ResponseNotFoundError,
    UnsupportedResponseFeatureError,
    handleResponseCancel: mockHandleResponseCancel,
    handleResponseCompact: mockHandleResponseCompact,
    handleResponseCreate: mockHandleResponseCreate,
    handleResponseCreateStream: mockHandleResponseCreateStream,
    handleResponseDelete: mockHandleResponseDelete,
    handleResponseInputItems: mockHandleResponseInputItems,
    handleResponseInputTokens: mockHandleResponseInputTokens,
    handleResponseRetrieve: mockHandleResponseRetrieve,
    submitBackgroundResponse: mockSubmitBackgroundResponse,
    readReasoningTokens: (usage: unknown) => {
      if (!usage || typeof usage !== "object") return undefined;
      const details = (usage as { output_tokens_details?: unknown }).output_tokens_details;
      if (!details || typeof details !== "object") return undefined;
      const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
      return typeof reasoning === "number" && Number.isFinite(reasoning) ? reasoning : undefined;
    },
  };
});

vi.mock("../../../src/middleware/api-key", () => ({
  apiKeyAuth: vi
    .fn()
    .mockImplementation(
      async (c: { set: (key: string, value: unknown) => void }, next: () => void) => {
        c.set("apiKeyId", "key-1");
        c.set("apiKeySpendLimitUsd", mockSpendLimit.value);
        c.set("apiKeyAllowAllModels", mockModelAccess.allowAllModels);
        c.set("apiKeyIncludeFutureModels", mockModelAccess.includeFutureModels);
        c.set("apiKeyAllowedModelIds", mockModelAccess.allowedModelIds);
        await next();
      },
    ),
  readApiKeyModelAccess: vi.fn(() => mockModelAccess),
}));

vi.mock("../../../src/middleware/logger", () => {
  class RequestLoggingUnavailableError extends Error {
    constructor() {
      super("request logging unavailable");
      this.name = "RequestLoggingUnavailableError";
    }
  }

  return {
    RequestLoggingUnavailableError,
    logStreamFinal: mockLogStreamFinal,
    logStreamStart: mockLogStreamStart,
  };
});

vi.mock("../../../src/providers/registry", () => ({ estimateCost: mockEstimateCost }));

vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeyModelAccessDeniedError extends Error {
    constructor(modelId: string) {
      super(`API key is not allowed to use model: ${modelId}`);
      this.name = "ApiKeyModelAccessDeniedError";
    }
  }

  class ApiKeySpendLimitExceededError extends Error {
    constructor() {
      super("API key spend limit exceeded");
      this.name = "ApiKeySpendLimitExceededError";
    }
  }

  class ApiKeySpendLedgerUnavailableError extends Error {
    constructor() {
      super("API key spend ledger unavailable");
      this.name = "ApiKeySpendLedgerUnavailableError";
    }
  }

  return {
    ApiKeyModelAccessDeniedError,
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    assertApiKeyModelAllowed: vi.fn(
      (modelId: string, access: { allowAllModels: boolean; allowedModelIds: string[] }) => {
        if (!access.allowAllModels && !access.allowedModelIds.includes(modelId)) {
          throw new ApiKeyModelAccessDeniedError(modelId);
        }
      },
    ),
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
  };
});

import { Hono } from "hono";
import { RequestLoggingUnavailableError } from "../../../src/middleware/logger";
import { UpstreamResponsesApiError } from "../../../src/providers/openai";
import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../../src/modules/keys/services";
import {
  ApiKeyUnbillableResponseUsageError,
  OpenAIResponseProviderNotConfiguredError,
  ResponseNotFoundError,
  UnsupportedResponseFeatureError,
} from "../../../src/modules/responses/services";
import { responsesRouter } from "../../../src/modules/responses/router";

describe("responses router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
    mockEstimateCost.mockReturnValue(0.01);
    mockLogStreamFinal.mockResolvedValue(undefined);
    mockLogStreamStart.mockResolvedValue("log-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST /v1/responses 400 invalid json", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", { method: "POST", body: "bad" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses 400 missing model", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses 400 missing input", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses 200 success", async () => {
    mockHandleResponseCreate.mockResolvedValueOnce({
      id: "resp-1",
      model: "openai:gpt-4o",
      output: [],
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "resp-1" });
    expect(mockHandleResponseCreate).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: false,
    });
  });

  it("POST /v1/responses preserves extended create fields after validation", async () => {
    mockHandleResponseCreate.mockResolvedValueOnce({
      id: "resp-extended",
      model: "openai:gpt-4o",
      output: [],
    });
    const body = {
      model: "openai:gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "describe this" },
            { type: "input_image", image_url: "https://example.test/image.png", detail: "low" },
            { type: "input_file", file_id: "file_1", filename: "notes.txt" },
          ],
        },
      ],
      include: ["file_search_call.results", "reasoning.encrypted_content"],
      conversation: { id: "conv_1" },
      context_management: { truncation: "auto" },
      enable_thinking: false,
      instructions: { text: "be brief" },
      max_tool_calls: 0,
      parallel_tool_calls: false,
      previous_response_id: "resp_prev",
      prompt_cache_key: "cache-key",
      prompt_cache_retention: { type: "ephemeral" },
      preset: "sonar",
      stream_options: { include_usage: true, include_obfuscation: true },
      top_logprobs: 0,
      top_p: 0,
      user: { id: "user-1" },
    };

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(200);
    expect(mockHandleResponseCreate).toHaveBeenCalledWith(expect.objectContaining(body), "key-1", {
      requireBillableUsage: false,
    });
  });

  it("returns 403 before handling disallowed response models", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];
    const app = new Hono().route("/v1/responses", responsesRouter);

    const create = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "anthropic:claude", input: "hi" }),
    });
    expect(create.status).toBe(403);
    await expect(create.json()).resolves.toEqual({
      error: "API key is not allowed to use model: anthropic:claude",
    });

    const compact = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "anthropic:claude", input: "hi" }),
    });
    expect(compact.status).toBe(403);

    const inputTokens = await app.request("/v1/responses/input_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "anthropic:claude", input: "hi" }),
    });
    expect(inputTokens.status).toBe(403);

    expect(mockAssertApiKeyCanSpend).not.toHaveBeenCalled();
    expect(mockHandleResponseCreate).not.toHaveBeenCalled();
    expect(mockHandleResponseCompact).not.toHaveBeenCalled();
    expect(mockHandleResponseInputTokens).not.toHaveBeenCalled();
  });

  it("POST /v1/responses 202 with Location header for background submissions", async () => {
    mockSubmitBackgroundResponse.mockResolvedValueOnce({
      id: "resp_bg_abc",
      response: {
        id: "resp_bg_abc",
        object: "response",
        status: "queued",
        model: "openai:gpt-4o",
      },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });

    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/v1/responses/resp_bg_abc");
    expect(mockSubmitBackgroundResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-4o", background: true }),
      "key-1",
      { requireBillableUsage: false },
    );
    expect(mockAssertApiKeyCanSpend).not.toHaveBeenCalled();
    expect(mockHandleResponseCreate).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      id: "resp_bg_abc",
      status: "queued",
    });
  });

  it("POST /v1/responses checks spend limit before limited background request", async () => {
    mockSpendLimit.value = 10;
    mockSubmitBackgroundResponse.mockResolvedValueOnce({
      id: "resp_bg_abc",
      response: { id: "resp_bg_abc", object: "response", status: "queued" },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });

    expect(res.status).toBe(202);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockSubmitBackgroundResponse).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: true,
    });
  });

  it("POST /v1/responses maps spend errors for background requests", async () => {
    mockSpendLimit.value = 10;
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const exhausted = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });
    expect(exhausted.status).toBe(429);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(
      new ApiKeySpendLedgerUnavailableError(new Error()),
    );
    const unavailable = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });
    expect(unavailable.status).toBe(503);
  });

  it("POST /v1/responses 404 when background submission targets an unknown model", async () => {
    mockSubmitBackgroundResponse.mockRejectedValueOnce(
      new Error("No provider found for model: nope:nada"),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nope:nada", input: "hi", background: true }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /v1/responses passes through upstream envelopes from background submissions", async () => {
    mockSubmitBackgroundResponse.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "Background mode requires gpt-5 family",
            type: "invalid_request_error",
            param: "model",
            code: "invalid_value",
          },
        }),
      ),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "Background mode requires gpt-5 family",
        type: "invalid_request_error",
      },
    });
  });

  it("POST /v1/responses streams raw SSE and finalizes usage logs", async () => {
    async function* chunks() {
      yield 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n';
      yield 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5,"output_tokens_details":{"reasoning_tokens":7}}}}\n\n';
    }

    mockHandleResponseCreateStream.mockResolvedValueOnce({
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-4o",
      startTime: Date.now(),
    });

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(res.text()).resolves.toBe(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5,"output_tokens_details":{"reasoning_tokens":7}}}}\n\n',
    );
    expect(mockLogStreamStart).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/v1/responses", statusCode: 102 }),
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        promptTokens: 2,
        completionTokens: 3,
        totalTokens: 5,
        reasoningTokens: 7,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /v1/responses allows limited streaming and charges after final usage", async () => {
    mockSpendLimit.value = 10;

    async function* chunks() {
      yield 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n';
    }

    mockHandleResponseCreateStream.mockResolvedValueOnce({
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-4o",
      startTime: Date.now(),
    });

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", stream: true }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
  });

  it("POST /v1/responses checks spend limit before limited request", async () => {
    mockSpendLimit.value = 10;
    mockHandleResponseCreate.mockResolvedValueOnce({
      id: "resp-1",
      model: "openai:gpt-4o",
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(200);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleResponseCreate).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: true,
    });
  });

  it("POST /v1/responses maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const body = JSON.stringify({ model: "openai:gpt-4o", input: "hi" });

    mockHandleResponseCreate.mockRejectedValueOnce(new Error("No provider found for model: x"));
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 404);

    mockHandleResponseCreate.mockRejectedValueOnce(
      new UnsupportedResponseFeatureError("Responses streaming is not supported yet"),
    );
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 422);

    mockHandleResponseCreate.mockRejectedValueOnce(new ApiKeyUnbillableResponseUsageError());
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 429);

    mockHandleResponseCreate.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 503);
  });

  it("POST /v1/responses maps spend limit errors", async () => {
    mockSpendLimit.value = 10;
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const exhausted = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });
    expect(exhausted.status).toBe(429);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(
      new ApiKeySpendLedgerUnavailableError(new Error()),
    );
    const unavailable = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });
    expect(unavailable.status).toBe(503);
  });

  it("GET /v1/responses/:id returns 200 with the response body", async () => {
    mockHandleResponseRetrieve.mockResolvedValueOnce({
      id: "resp_abc",
      object: "response",
      status: "completed",
      model: "gpt-4o-2024-08-06",
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseRetrieve).toHaveBeenCalledWith("resp_abc", "key-1", undefined);
    await expect(res.json()).resolves.toMatchObject({ id: "resp_abc" });
  });

  it("GET /v1/responses/:id returns 202 + Location when the row is still pending", async () => {
    mockHandleResponseRetrieve.mockResolvedValueOnce({
      id: "resp_bg_abc",
      object: "response",
      status: "queued",
      _pending: true,
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_bg_abc", { method: "GET" });

    expect(res.status).toBe(202);
    expect(res.headers.get("Location")).toBe("/v1/responses/resp_bg_abc");
    const body = await res.json();
    expect(body).toMatchObject({
      id: "resp_bg_abc",
      status: "queued",
    });
    expect(body).not.toHaveProperty("_pending");
  });

  it("GET /v1/responses/:id maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new OpenAIResponseProviderNotConfiguredError(),
    );
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(new UnsupportedResponseFeatureError("nope"));
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      422,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new RequestLoggingUnavailableError(new Error()),
    );
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new UpstreamResponsesApiError(404, JSON.stringify({ error: { message: "not found" } })),
    );
    const notFound = await app.request("/v1/responses/resp_abc", { method: "GET" });
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toMatchObject({
      error: { message: "not found" },
    });

    mockHandleResponseRetrieve.mockRejectedValueOnce(new Error("boom"));
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      500,
    );
  });

  it("GET /v1/responses/:id forwards repeated query params to the service", async () => {
    mockHandleResponseRetrieve.mockResolvedValueOnce({ id: "resp_abc" });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request(
      "/v1/responses/resp_abc?include=file_search_call.results&include=message.input_image&include_obfuscation=true",
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    expect(mockHandleResponseRetrieve).toHaveBeenCalledWith("resp_abc", "key-1", {
      include: ["file_search_call.results", "message.input_image"],
      include_obfuscation: "true",
    });
  });

  it("POST /v1/responses surfaces the OpenAI error envelope with the original status", async () => {
    mockHandleResponseCreate.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "Invalid value for 'model'",
            type: "invalid_request_error",
            param: "model",
            code: "invalid_value",
          },
        }),
      ),
    );

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:bogus", input: "hi" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "Invalid value for 'model'",
        type: "invalid_request_error",
        param: "model",
        code: "invalid_value",
      },
    });
  });

  it("POST /v1/responses falls back to message body for non-JSON upstream errors", async () => {
    mockHandleResponseCreate.mockRejectedValueOnce(
      new UpstreamResponsesApiError(500, "internal server error"),
    );

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("OpenAI Responses API error: 500"),
    });
  });

  it("DELETE /v1/responses/:id returns 200 with the OpenAI confirmation body", async () => {
    mockHandleResponseDelete.mockResolvedValueOnce({
      id: "resp_abc",
      object: "response",
      deleted: true,
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseDelete).toHaveBeenCalledWith("resp_abc", "key-1");
    await expect(res.json()).resolves.toMatchObject({ id: "resp_abc", deleted: true });
  });

  it("DELETE /v1/responses/:id surfaces the OpenAI error envelope on 404", async () => {
    mockHandleResponseDelete.mockRejectedValueOnce(
      new UpstreamResponsesApiError(404, JSON.stringify({ error: { message: "not found" } })),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: { message: "not found" } });
  });

  it("DELETE /v1/responses/:id maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockHandleResponseDelete.mockRejectedValueOnce(new OpenAIResponseProviderNotConfiguredError());
    expect(await app.request("/v1/responses/resp_abc", { method: "DELETE" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseDelete.mockRejectedValueOnce(new UnsupportedResponseFeatureError("nope"));
    expect(await app.request("/v1/responses/resp_abc", { method: "DELETE" })).toHaveProperty(
      "status",
      422,
    );

    mockHandleResponseDelete.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    expect(await app.request("/v1/responses/resp_abc", { method: "DELETE" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseDelete.mockRejectedValueOnce(new Error("boom"));
    expect(await app.request("/v1/responses/resp_abc", { method: "DELETE" })).toHaveProperty(
      "status",
      500,
    );
  });

  it("POST /v1/responses/:id/cancel returns 200 with the upstream body", async () => {
    mockHandleResponseCancel.mockResolvedValueOnce({
      provider: "openai",
      model: "openai",
      response: {
        id: "resp_abc",
        object: "response",
        status: "cancelled",
      },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc/cancel", { method: "POST" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseCancel).toHaveBeenCalledWith("resp_abc", "key-1");
    await expect(res.json()).resolves.toMatchObject({
      id: "resp_abc",
      status: "cancelled",
    });
  });

  it("POST /v1/responses/:id/cancel accepts an empty body", async () => {
    mockHandleResponseCancel.mockResolvedValueOnce({
      provider: "openai",
      model: "openai",
      response: { id: "resp_abc", status: "cancelled" },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc/cancel", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /v1/responses/:id/cancel returns 404 when the service raises ResponseNotFoundError", async () => {
    mockHandleResponseCancel.mockRejectedValueOnce(new ResponseNotFoundError("resp_x"));
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_x/cancel", { method: "POST" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("Response not found"),
    });
  });

  it("POST /v1/responses/:id/cancel passes through the upstream envelope on non-404 errors", async () => {
    mockHandleResponseCancel.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "Response is not cancellable",
            type: "invalid_request_error",
            param: null,
            code: "invalid_value",
          },
        }),
      ),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc/cancel", { method: "POST" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "Response is not cancellable",
        type: "invalid_request_error",
        param: null,
        code: "invalid_value",
      },
    });
  });

  it("POST /v1/responses/:id/cancel maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockHandleResponseCancel.mockRejectedValueOnce(new OpenAIResponseProviderNotConfiguredError());
    expect(await app.request("/v1/responses/resp_abc/cancel", { method: "POST" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseCancel.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    expect(await app.request("/v1/responses/resp_abc/cancel", { method: "POST" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseCancel.mockRejectedValueOnce(new Error("boom"));
    expect(await app.request("/v1/responses/resp_abc/cancel", { method: "POST" })).toHaveProperty(
      "status",
      500,
    );
  });

  it("GET /v1/responses/:id/input_items returns 200 with the upstream body", async () => {
    mockHandleResponseInputItems.mockResolvedValueOnce({
      provider: "openai",
      model: "openai",
      response: {
        object: "list",
        data: [{ id: "msg_abc", type: "message", role: "user" }],
        first_id: "msg_abc",
        last_id: "msg_abc",
        has_more: false,
      },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc/input_items", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseInputItems).toHaveBeenCalledWith("resp_abc", "key-1", undefined);
    await expect(res.json()).resolves.toMatchObject({
      object: "list",
      has_more: false,
    });
  });

  it("GET /v1/responses/:id/input_items forwards query params to the service", async () => {
    mockHandleResponseInputItems.mockResolvedValueOnce({
      provider: "openai",
      model: "openai",
      response: { object: "list", data: [], has_more: false },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const url =
      "/v1/responses/resp_abc/input_items" +
      "?after=msg_xyz&include=file_search_call.results" +
      "&include=message.input_image.image_url&limit=20&order=desc";
    const res = await app.request(url, { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseInputItems).toHaveBeenCalledWith("resp_abc", "key-1", {
      after: "msg_xyz",
      include: ["file_search_call.results", "message.input_image.image_url"],
      limit: "20",
      order: "desc",
    });
  });

  it("GET /v1/responses/:id/input_items returns 404 when the service raises ResponseNotFoundError", async () => {
    mockHandleResponseInputItems.mockRejectedValueOnce(new ResponseNotFoundError("resp_x"));
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_x/input_items", { method: "GET" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("Response not found"),
    });
  });

  it("GET /v1/responses/:id/input_items passes through the upstream envelope on non-404 errors", async () => {
    mockHandleResponseInputItems.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "Invalid include value",
            type: "invalid_request_error",
            param: "include",
            code: "invalid_value",
          },
        }),
      ),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc/input_items?include=foo", {
      method: "GET",
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "Invalid include value",
        type: "invalid_request_error",
        param: "include",
        code: "invalid_value",
      },
    });
  });

  it("GET /v1/responses/:id/input_items maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockHandleResponseInputItems.mockRejectedValueOnce(
      new OpenAIResponseProviderNotConfiguredError(),
    );
    expect(
      await app.request("/v1/responses/resp_abc/input_items", { method: "GET" }),
    ).toHaveProperty("status", 503);

    mockHandleResponseInputItems.mockRejectedValueOnce(new UnsupportedResponseFeatureError("nope"));
    expect(
      await app.request("/v1/responses/resp_abc/input_items", { method: "GET" }),
    ).toHaveProperty("status", 422);

    mockHandleResponseInputItems.mockRejectedValueOnce(
      new RequestLoggingUnavailableError(new Error()),
    );
    expect(
      await app.request("/v1/responses/resp_abc/input_items", { method: "GET" }),
    ).toHaveProperty("status", 503);

    mockHandleResponseInputItems.mockRejectedValueOnce(new Error("boom"));
    expect(
      await app.request("/v1/responses/resp_abc/input_items", { method: "GET" }),
    ).toHaveProperty("status", 500);
  });

  it("POST /v1/responses/input_tokens returns 200 with the upstream body", async () => {
    mockHandleResponseInputTokens.mockResolvedValueOnce({
      provider: "openai",
      model: "openai:gpt-4o",
      response: { object: "response.input_tokens", input_tokens: 42 },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/input_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleResponseInputTokens).toHaveBeenCalledWith(
      { model: "openai:gpt-4o", input: "hi" },
      "key-1",
    );
    await expect(res.json()).resolves.toMatchObject({
      object: "response.input_tokens",
      input_tokens: 42,
    });
  });

  it("POST /v1/responses/input_tokens returns 400 for malformed JSON", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/input_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    expect(res.status).toBe(400);
    expect(mockHandleResponseInputTokens).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("valid JSON"),
    });
  });

  it("POST /v1/responses/input_tokens returns 404 when the service raises ResponseNotFoundError", async () => {
    mockHandleResponseInputTokens.mockRejectedValueOnce(
      new ResponseNotFoundError("(model: gpt-4o)"),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/input_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("Response not found"),
    });
  });

  it("POST /v1/responses/input_tokens passes through the upstream envelope on non-404 errors", async () => {
    mockHandleResponseInputTokens.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "Invalid model",
            type: "invalid_request_error",
            param: "model",
            code: "invalid_value",
          },
        }),
      ),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/input_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nope", input: "hi" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "Invalid model",
        type: "invalid_request_error",
        param: "model",
        code: "invalid_value",
      },
    });
  });

  it("POST /v1/responses/input_tokens maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const payload = JSON.stringify({ model: "gpt-4o", input: "hi" });
    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    };

    mockHandleResponseInputTokens.mockRejectedValueOnce(
      new OpenAIResponseProviderNotConfiguredError(),
    );
    expect(await app.request("/v1/responses/input_tokens", opts)).toHaveProperty("status", 503);

    mockHandleResponseInputTokens.mockRejectedValueOnce(
      new UnsupportedResponseFeatureError("nope"),
    );
    expect(await app.request("/v1/responses/input_tokens", opts)).toHaveProperty("status", 422);

    mockHandleResponseInputTokens.mockRejectedValueOnce(
      new RequestLoggingUnavailableError(new Error()),
    );
    expect(await app.request("/v1/responses/input_tokens", opts)).toHaveProperty("status", 503);

    mockHandleResponseInputTokens.mockRejectedValueOnce(new Error("boom"));
    expect(await app.request("/v1/responses/input_tokens", opts)).toHaveProperty("status", 500);
  });

  it("POST /v1/responses/compact returns 200 with the upstream body", async () => {
    mockHandleResponseCompact.mockResolvedValueOnce({
      provider: "openai",
      model: "openai:gpt-5",
      response: {
        id: "resp_001",
        object: "response.compaction",
        output: [{ id: "cmp_001", type: "compaction" }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai:gpt-5",
        input: "hi",
        instructions: { text: "preserve tool state" },
        previous_response_id: "resp_prev",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleResponseCompact).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:gpt-5",
        input: "hi",
        instructions: { text: "preserve tool state" },
        previous_response_id: "resp_prev",
      }),
      "key-1",
      { requireBillableUsage: false },
    );
    await expect(res.json()).resolves.toMatchObject({
      id: "resp_001",
      object: "response.compaction",
    });
  });

  it("POST /v1/responses/compact returns 400 on a missing model", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    expect(res.status).toBe(400);
    expect(mockHandleResponseCompact).not.toHaveBeenCalled();
  });

  it("POST /v1/responses/compact strips unknown fields", async () => {
    mockHandleResponseCompact.mockResolvedValueOnce({
      provider: "openai",
      model: "openai:gpt-5",
      response: { id: "resp_001", object: "response.compaction", output: [] },
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-5", unknown: "nope" }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleResponseCompact).toHaveBeenCalledWith({ model: "openai:gpt-5" }, "key-1", {
      requireBillableUsage: false,
    });
  });

  it("POST /v1/responses/compact passes through the upstream envelope on non-404 errors", async () => {
    mockHandleResponseCompact.mockRejectedValueOnce(
      new UpstreamResponsesApiError(
        400,
        JSON.stringify({
          error: {
            message: "compact failed",
            type: "invalid_request_error",
            param: null,
            code: "invalid_value",
          },
        }),
      ),
    );
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-5", input: "hi" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: "compact failed",
        type: "invalid_request_error",
        param: null,
        code: "invalid_value",
      },
    });
  });

  it("POST /v1/responses/compact returns 404 on ResponseNotFoundError", async () => {
    mockHandleResponseCompact.mockRejectedValueOnce(new ResponseNotFoundError("openai:gpt-5"));
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-5", input: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /v1/responses/compact maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const body = JSON.stringify({ model: "openai:gpt-5", input: "hi" });

    mockHandleResponseCompact.mockRejectedValueOnce(new UnsupportedResponseFeatureError("nope"));
    expect(
      await app.request("/v1/responses/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 422);

    mockHandleResponseCompact.mockRejectedValueOnce(new ApiKeyUnbillableResponseUsageError());
    expect(
      await app.request("/v1/responses/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 429);

    mockHandleResponseCompact.mockRejectedValueOnce(new Error("boom"));
    expect(
      await app.request("/v1/responses/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 500);
  });
});
