import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleImageGeneration,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleImageGeneration: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/images/services", () => ({
  handleImageGeneration: mockHandleImageGeneration,
}));
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
import { imageGenerationsRouter } from "../../../src/modules/images/router";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

describe("image generations router", () => {
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
    const app = new Hono().route("/v1/images/generations", imageGenerationsRouter);
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 200 returns non-stream image responses", async () => {
    mockHandleImageGeneration.mockResolvedValueOnce({
      kind: "complete",
      response: { created: 1, data: [{ url: "https://example.test/cat.png" }] },
    });

    const app = new Hono().route("/v1/images/generations", imageGenerationsRouter);
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: "cat" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleImageGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        recordSpend: false,
        rawBody: JSON.stringify({ model: "gpt-image-1", prompt: "cat" }),
      }),
    );
  });

  it("POST / returns upstream OpenAI-compatible errors verbatim", async () => {
    mockHandleImageGeneration.mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 429,
        body: '{"error":{"message":"rate limited"}}',
        contentType: "application/json",
      }),
    );

    const app = new Hono().route("/v1/images/generations", imageGenerationsRouter);
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: "cat" }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe('{"error":{"message":"rate limited"}}');
  });

  it("POST / streams raw SSE and records usage when available", async () => {
    mockSpendLimit.value = 10;
    async function* chunks() {
      yield 'data: {"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n';
      yield "data: [DONE]\n\n";
    }
    mockHandleImageGeneration.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-image-1",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/images/generations", imageGenerationsRouter);
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: "cat", stream: true }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe(
      'data: {"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(mockHandleImageGeneration).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        recordSpend: false,
        rawBody: JSON.stringify({ model: "gpt-image-1", prompt: "cat", stream: true }),
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
