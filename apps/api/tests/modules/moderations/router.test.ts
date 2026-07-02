import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertApiKeyCanSpend, mockHandleModeration, mockModelAccess, mockSpendLimit } =
  vi.hoisted(() => ({
    mockAssertApiKeyCanSpend: vi.fn(),
    mockHandleModeration: vi.fn(),
    mockModelAccess: {
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: [] as string[],
    },
    mockSpendLimit: { value: null as number | null },
  }));

vi.mock("../../../src/modules/moderations/services", () => ({
  handleModeration: mockHandleModeration,
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
  return { RequestLoggingUnavailableError };
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
  class ApiKeySpendLedgerUnavailableError extends Error {}

  return {
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
import { moderationsRouter } from "../../../src/modules/moderations/router";
import { ApiKeySpendLimitExceededError } from "../../../src/modules/keys/services";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

describe("moderations router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST / 400 invalid json", async () => {
    const app = new Hono().route("/v1/moderations", moderationsRouter);
    const res = await app.request("/v1/moderations", { method: "POST", body: "bad" });
    expect(res.status).toBe(400);
  });

  it("POST / defaults the model and returns the moderation response", async () => {
    mockHandleModeration.mockResolvedValueOnce({
      id: "modr-1",
      model: "text-moderation-latest",
      results: [{ flagged: false }],
    });

    const app = new Hono().route("/v1/moderations", moderationsRouter);
    const res = await app.request("/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleModeration).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:text-moderation-latest", input: "hello" }),
      "key-1",
      expect.objectContaining({
        recordSpend: false,
        rawBody: JSON.stringify({ input: "hello" }),
      }),
    );
  });

  it("POST / checks spend limit before limited requests", async () => {
    mockSpendLimit.value = 10;
    mockHandleModeration.mockResolvedValueOnce({
      id: "modr-1",
      model: "omni-moderation-latest",
      results: [],
    });

    const app = new Hono().route("/v1/moderations", moderationsRouter);
    const res = await app.request("/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleModeration).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        recordSpend: true,
        rawBody: JSON.stringify({ model: "omni-moderation-latest", input: "hello" }),
      }),
    );
  });

  it("POST / returns upstream OpenAI-compatible errors verbatim", async () => {
    mockHandleModeration.mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 400,
        body: '{"error":{"message":"bad input"}}',
        contentType: "application/json",
      }),
    );

    const app = new Hono().route("/v1/moderations", moderationsRouter);
    const res = await app.request("/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe('{"error":{"message":"bad input"}}');
  });

  it("POST / 429 when spend limit is exhausted", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());

    const app = new Hono().route("/v1/moderations", moderationsRouter);
    const res = await app.request("/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    expect(res.status).toBe(429);
    expect(mockHandleModeration).not.toHaveBeenCalled();
  });
});
