import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";

const { mockHandleEmbedding, mockModelAccess, mockResolveAccessModel, mockSpendLimit } = vi.hoisted(
  () => ({
    mockHandleEmbedding: vi.fn(),
    mockResolveAccessModel: vi.fn(async (model: string) => model),
    mockModelAccess: {
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: [] as string[],
    },
    mockSpendLimit: { value: null as number | null },
  }),
);

vi.mock("../../../src/modules/embeddings/services", () => {
  class ApiKeyUnbillableEmbeddingUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableEmbeddingUsageError";
    }
  }

  return {
    ApiKeyUnbillableEmbeddingUsageError,
    handleEmbedding: mockHandleEmbedding,
  };
});
vi.mock("../../../src/middleware/api-key", () => ({
  openAIApiKeyAuth: vi
    .fn()
    .mockImplementation(
      async (c: { set: (key: string, value: unknown) => void }, next: () => void) => {
        c.set("apiKeyId", "key-1");
        c.set("apiKeySpendLimitUsd", mockSpendLimit.value);
        c.set("apiKeyOwnSpendLimitUsd", mockSpendLimit.value);
        c.set("apiKeyOwnerSpendLimitUsd", null);
        c.set("apiKeyAllowAllModels", mockModelAccess.allowAllModels);
        c.set("apiKeyIncludeFutureModels", mockModelAccess.includeFutureModels);
        c.set("apiKeyAllowedModelIds", mockModelAccess.allowedModelIds);
        await next();
      },
    ),
  readApiKeyModelAccess: vi.fn(() => mockModelAccess),
}));
vi.mock("../../../src/providers/registry", () => ({
  resolveEmbeddingAccessModelId: mockResolveAccessModel,
}));
vi.mock("../../../src/middleware/logger", () => {
  class RequestLoggingUnavailableError extends Error {
    constructor() {
      super("request logging unavailable");
      this.name = "RequestLoggingUnavailableError";
    }
  }

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
import { embeddingsRouter } from "../../../src/modules/embeddings/router";
import { ApiKeyUnbillableEmbeddingUsageError } from "../../../src/modules/embeddings/services";
import { RequestLoggingUnavailableError } from "../../../src/middleware/logger";
import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../../src/modules/keys/services";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

describe("embeddings router", () => {
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
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    });
    expect(res.status).toBe(400);
  });

  it("POST / 400 missing model", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 400 missing input", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 400 rejects mixed input arrays", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: ["hello", 1] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 400 rejects oversized string input arrays", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai:text-embedding-3-small",
        input: Array.from({ length: 2049 }, () => "hello"),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / 200 success", async () => {
    mockHandleEmbedding.mockResolvedValueOnce({
      response: {
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: "openai:text-embedding-3-small",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
      status: 200,
      headers: new Headers(),
    });

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai:text-embedding-3-small",
        input: [1, 2, 3],
        dimensions: 256,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      model: "openai:text-embedding-3-small",
    });
    expect(mockHandleEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: false,
        rawBody: JSON.stringify({
          model: "openai:text-embedding-3-small",
          input: [1, 2, 3],
          dimensions: 256,
        }),
      }),
    );
  });

  it("POST /v1/engines/:model/embeddings fills the model from the path", async () => {
    mockHandleEmbedding.mockResolvedValueOnce({
      response: {
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
      status: 200,
      headers: new Headers(),
    });

    const app = new Hono().route("/v1/engines/:model/embeddings", embeddingsRouter);
    const res = await app.request("/v1/engines/text-embedding-3-small/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-small", input: "hello" }),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: false,
        rawBody: JSON.stringify({ input: "hello", model: "text-embedding-3-small" }),
      }),
    );
  });

  it("POST / 403 when the API key cannot access the model", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(403);
    expect(mockHandleEmbedding).not.toHaveBeenCalled();
  });

  it("POST / passes atomic billing limits to limited requests", async () => {
    mockSpendLimit.value = 10;
    mockHandleEmbedding.mockResolvedValueOnce({
      response: {
        object: "list",
        data: [],
        model: "openai:text-embedding-3-small",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
      status: 200,
      headers: new Headers(),
    });

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(mockHandleEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      expect.objectContaining({
        requireBillableUsage: true,
        billing: expect.objectContaining({ apiKeyId: "key-1", apiKeyLimitUsd: 10 }),
        rawBody: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
      }),
    );
  });

  it("POST / 429 when spend limit is exhausted", async () => {
    mockSpendLimit.value = 10;
    mockHandleEmbedding.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(429);
    expect(mockHandleEmbedding).toHaveBeenCalled();
  });

  it("POST / 404 no provider", async () => {
    mockHandleEmbedding.mockRejectedValueOnce(
      new Error("No provider found for model: openai:text-embedding-3-small"),
    );

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(404);
  });

  it("POST / 429 when limited usage cannot be billed", async () => {
    mockSpendLimit.value = 10;
    mockHandleEmbedding.mockRejectedValueOnce(new ApiKeyUnbillableEmbeddingUsageError());

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(429);
  });

  it("POST / 503 when request logging is unavailable", async () => {
    mockHandleEmbedding.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(503);
  });

  it("POST / 503 when spend ledger is unavailable", async () => {
    mockSpendLimit.value = 10;
    mockHandleEmbedding.mockRejectedValueOnce(new ApiKeySpendLedgerUnavailableError(new Error()));

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(503);
    expect(mockHandleEmbedding).toHaveBeenCalled();
  });

  it("POST / 500 generic error", async () => {
    mockHandleEmbedding.mockRejectedValueOnce(new Error("Something broke"));

    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });

    expect(res.status).toBe(500);
  });

  it("returns an OpenAI-compatible 415 for non-JSON content", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toMatchObject({
      error: { type: "invalid_request_error", code: "unsupported_media_type" },
    });
  });

  it("rejects bodies whose declared size exceeds the decompressed limit", async () => {
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(128 * 1024 * 1024 + 1),
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "request_body_too_large" },
    });
  });

  it("accepts gzip-compressed JSON bodies", async () => {
    mockHandleEmbedding.mockResolvedValueOnce({
      response: {
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: "openai:text-embedding-3-small",
      },
      status: 200,
      headers: new Headers(),
    });
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const body = { model: "openai:text-embedding-3-small", input: "compressed" };
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      body: gzipSync(JSON.stringify(body)),
    });
    expect(res.status).toBe(200);
    expect(mockHandleEmbedding).toHaveBeenCalledWith(
      body,
      "key-1",
      expect.objectContaining({ rawBody: JSON.stringify(body) }),
    );
  });

  it("checks model access against the canonical resolved model", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:text-embedding-3-small"];
    mockResolveAccessModel.mockResolvedValueOnce("openai:text-embedding-3-small");
    mockHandleEmbedding.mockResolvedValueOnce({
      response: { object: "list", data: [], model: "alias:embed" },
      status: 200,
      headers: new Headers(),
    });
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "alias:embed", input: "hello" }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleEmbedding).toHaveBeenCalled();
  });

  it("forwards safe upstream headers without replacing the gateway request ID", async () => {
    mockHandleEmbedding.mockResolvedValueOnce({
      response: { object: "list", data: [], model: "openai:text-embedding-3-small" },
      status: 201,
      headers: new Headers({
        "x-upstream-limit": "42",
        "x-request-id": "upstream-id",
        "set-cookie": "secret=true",
      }),
    });
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-upstream-limit")).toBe("42");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("x-request-id")).not.toBe("upstream-id");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sanitizes upstream errors and preserves Retry-After", async () => {
    mockHandleEmbedding.mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "fixture",
        status: 429,
        body: JSON.stringify({
          error: {
            message: "authorization: Bearer sk-secretsecretsecret",
            type: "rate_limit_error",
          },
        }),
        retryAfter: "9",
      }),
    );
    const app = new Hono().route("/v1/embeddings", embeddingsRouter);
    const res = await app.request("/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:text-embedding-3-small", input: "hello" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    const text = await res.text();
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("request_id");
    expect(text).not.toContain("sk-secretsecretsecret");
  });
});
