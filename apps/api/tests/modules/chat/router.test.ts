import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleChatCompletion,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleChatCompletion: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/chat/services", () => {
  class ApiKeyUnbillableUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableUsageError";
    }
  }

  return { ApiKeyUnbillableUsageError, handleChatCompletion: mockHandleChatCompletion };
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
vi.mock("../../../src/providers/chat-compat", () => {
  class UnsupportedChatFeatureError extends Error {
    constructor() {
      super("Model x does not support requested feature(s): structuredOutput");
      this.name = "UnsupportedChatFeatureError";
    }
  }

  return {
    UnsupportedChatFeatureError,
    validateChatCompletionRequestShape: vi.fn(
      (body: {
        model?: string;
        messages?: unknown;
        prefix?: unknown;
        suffix?: unknown;
        max_tokens?: number;
        web_search_options?: { search_context_size?: string };
      }) => {
        if (!body.model) return "request must include a model";
        if (typeof body.max_tokens === "number" && body.max_tokens > Math.floor(2_147_483_647 / 2))
          return "max_tokens is invalid";
        if (body.messages !== undefined && !Array.isArray(body.messages))
          return "messages must be an array";
        if (body.web_search_options) {
          const searchContextSize = body.web_search_options.search_context_size;
          if (!searchContextSize) body.web_search_options.search_context_size = "medium";
          if (searchContextSize && !["high", "medium", "low"].includes(searchContextSize)) {
            return "invalid search_context_size, must be one of: high, medium, low";
          }
        }

        const messages = Array.isArray(body.messages) ? body.messages : [];
        const hasFimInput =
          (Object.hasOwn(body, "prefix") && body.prefix !== null) ||
          (Object.hasOwn(body, "suffix") && body.suffix !== null);
        if (messages.length === 0 && !hasFimInput)
          return "request must include a non-empty messages array or prefix/suffix";

        const invalidMessageIndex = messages.findIndex(
          (message) => !message || typeof message !== "object",
        );
        return invalidMessageIndex >= 0
          ? `messages[${invalidMessageIndex}] must be an object`
          : null;
      },
    ),
  };
});
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
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    ApiKeyModelAccessDeniedError,
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
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
import { chatRouter } from "../../../src/modules/chat/router";
import { ApiKeyUnbillableUsageError } from "../../../src/modules/chat/services";
import { RequestLoggingUnavailableError } from "../../../src/middleware/logger";
import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../../src/modules/keys/services";
import { UnsupportedChatFeatureError } from "../../../src/providers/chat-compat";

describe("chat router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
    mockLogStreamStart.mockResolvedValue("log-1");
    mockLogStreamFinal.mockResolvedValue(undefined);
    mockEstimateCost.mockReturnValue(0.01);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST /completions 400 invalid json", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", { method: "POST", body: "bad" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: "invalid JSON body",
        type: "invalid_request_error",
        code: "bad_request_body",
      }),
    });
  });

  it("POST /completions 400 missing model", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: "request must include a model",
        type: "invalid_request_error",
        code: "invalid_request",
      }),
    });
  });

  it("POST /completions 400 empty messages", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: "request must include a non-empty messages array or prefix/suffix",
      }),
    });
  });

  it("POST /completions forwards broad chat fields without local role rejection", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const request = {
      model: "gpt-4",
      messages: [
        { role: "developer", content: "be concise" },
        {
          role: "user",
          content: [{ type: "video_url", video_url: { url: "https://x.test/video.mp4" } }],
          cache_control: { type: "ephemeral" },
        },
        { role: "tool", content: "ok" },
      ],
      functions: [{ name: "legacy_lookup" }],
      function_call: { name: "legacy_lookup" },
      temperature: 0,
      store: false,
      prompt_cache_retention: null,
      web_search_options: { search_context_size: "medium" },
      enable_thinking: false,
    };

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining(request),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: false,
      }),
    );
  });

  it("POST /completions accepts FIM-style prefix requests without messages", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", prefix: "function answer() {" }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4", prefix: "function answer() {" }),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
  });

  it("POST /completions passes the original raw JSON body to the service", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const rawBody = '{\n  "model": "gpt-4",\n  "messages": [{"role":"user","content":"hi"}]\n}';
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });

    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4" }),
      "key-1",
      expect.objectContaining({ rawBody }),
    );
  });

  it("POST /completions accepts non-null FIM prefix values like new-api", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", prefix: "" }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4", prefix: "" }),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
  });

  it("POST /completions defaults web search context size", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "search" }],
        web_search_options: {},
      }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ web_search_options: { search_context_size: "medium" } }),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
  });

  it("POST /completions 404 no provider", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(
      new Error("No provider found for model: unknown"),
    );
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "unknown", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: "No provider found for model: unknown",
        type: "invalid_request_error",
        code: "model_not_found",
      }),
    });
  });

  it("POST /completions 200 success", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
  });

  it("POST /completions 403 when the API key cannot access the model", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic:claude",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: expect.objectContaining({
        message: "API key is not allowed to use model: anthropic:claude",
        type: "invalid_request_error",
        code: "access_denied",
      }),
    });
    expect(mockAssertApiKeyCanSpend).not.toHaveBeenCalled();
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions checks spend limit before limited request", async () => {
    mockSpendLimit.value = 10;
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({ requireBillableUsage: true }),
    );
  });

  it("POST /completions 429 when spend limit is exhausted", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions 429 when spend limit is exhausted before streaming", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(429);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions checks and bills limited streaming requests", async () => {
    mockSpendLimit.value = 10;
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCost: 0.01,
        latencyMs: 25,
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions 429 when limited request cannot be billed", async () => {
    mockSpendLimit.value = 10;
    mockHandleChatCompletion.mockRejectedValueOnce(new ApiKeyUnbillableUsageError());
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
  });

  it("POST /completions pre-enqueues and finalizes streaming logs", async () => {
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(mockLogStreamStart).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-4", statusCode: 102 }),
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions logs usage from a usage-only chunk after finish_reason", async () => {
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
        usage: null,
      };
      yield {
        id: "chunk-2",
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: null,
      };
      yield {
        id: "chunk-3",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 17, total_tokens: 28 },
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain('"choices":[]');
    expect(mockLogStreamFinal).toHaveBeenCalledTimes(1);
    expect(mockEstimateCost).toHaveBeenCalledWith("gpt-4", 11, 17, undefined, undefined);
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        promptTokens: 11,
        completionTokens: 17,
        totalTokens: 28,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions hides usage-only stream chunks when include_usage is false", async () => {
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
        usage: null,
      };
      yield {
        id: "chunk-2",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 17, total_tokens: 28 },
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        stream_options: { include_usage: false },
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"content":"OK"');
    expect(text).not.toContain('"usage":{"prompt_tokens":11');
    expect(mockEstimateCost).toHaveBeenCalledWith("gpt-4", 11, 17, undefined, undefined);
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 11,
        completionTokens: 17,
        totalTokens: 28,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions does not bill limited streaming requests without estimated cost", async () => {
    mockSpendLimit.value = 10;
    mockEstimateCost.mockReturnValueOnce(undefined);
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [],
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCost: undefined,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions 503 when request logging is unavailable", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
  });

  it("POST /completions 503 when spend ledger is unavailable", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(
      new ApiKeySpendLedgerUnavailableError(new Error()),
    );
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions 422 when requested features are unsupported", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(
      new UnsupportedChatFeatureError("anthropic:claude", ["structuredOutput"]),
    );
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic:claude",
        messages: [{ role: "user", content: "hi" }],
        response_format: { type: "json_object" },
      }),
    });
    expect(res.status).toBe(422);
  });

  it("POST /completions 500 generic error", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(new Error("Something broke"));
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(500);
  });
});
