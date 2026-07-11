import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleCompletion,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleCompletion: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/completions/services", () => {
  class ApiKeyUnbillableCompletionUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableCompletionUsageError";
    }
  }

  return {
    ApiKeyUnbillableCompletionUsageError,
    handleCompletion: mockHandleCompletion,
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
  class RequestLoggingUnavailableError extends Error {}
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
  class ApiKeySpendLedgerUnavailableError extends Error {}

  return {
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    ApiKeyModelAccessDeniedError,
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
    assertApiKeyModelAllowed: vi.fn(
      (modelId: string, access: { allowAllModels: boolean; allowedModelIds: string[] }) => {
        if (!access.allowAllModels && !access.allowedModelIds.includes(modelId)) {
          throw new ApiKeyModelAccessDeniedError(modelId);
        }
      },
    ),
  };
});

import { Hono } from "hono";
import { completionsRouter } from "../../../src/modules/completions/router";
import { ApiKeyUnbillableCompletionUsageError } from "../../../src/modules/completions/services";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

describe("completions router", () => {
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

  it("POST / 400 missing prompt", async () => {
    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5-turbo-instruct" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 200 returns non-stream completion responses", async () => {
    mockHandleCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "cmpl-1",
        model: "gpt-3.5-turbo-instruct",
        choices: [{ text: "hi", index: 0 }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });

    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: false,
        rawBody: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
      }),
    );
  });

  it("POST / passes requireBillableUsage for limited non-stream requests", async () => {
    mockSpendLimit.value = 10;
    mockHandleCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: { id: "cmpl-1", model: "gpt-3.5-turbo-instruct", choices: [] },
    });

    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: true,
        rawBody: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
      }),
    );
  });

  it("POST / 429 when limited non-stream usage cannot be billed", async () => {
    mockSpendLimit.value = 10;
    mockHandleCompletion.mockRejectedValueOnce(new ApiKeyUnbillableCompletionUsageError());

    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
    });

    expect(res.status).toBe(429);
  });

  it("POST / returns upstream OpenAI-compatible errors verbatim", async () => {
    mockHandleCompletion.mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 400,
        body: '{"error":{"message":"bad prompt"}}',
        contentType: "application/json",
      }),
    );

    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-3.5-turbo-instruct", prompt: "hello" }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe('{"error":{"message":"bad prompt"}}');
  });

  it("POST / streams raw SSE and records usage when available", async () => {
    mockSpendLimit.value = 10;
    async function* chunks() {
      yield 'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n';
      yield "data: [DONE]\n\n";
    }
    mockHandleCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-3.5-turbo-instruct",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/completions", completionsRouter);
    const res = await app.request("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-3.5-turbo-instruct",
        prompt: "hello",
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe(
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(mockHandleCompletion).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: false,
        rawBody: JSON.stringify({
          model: "gpt-3.5-turbo-instruct",
          prompt: "hello",
          stream: true,
        }),
      }),
    );
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        latencyMs: 25,
        promptTokens: 2,
        completionTokens: 3,
        totalTokens: 5,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });
});
