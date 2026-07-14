import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockLogRequest,
  mockExpandSpendReservation,
  mockRefundSpendReservation,
  mockReserveSpend,
  mockResolveEmbeddingModel,
  mockSettleSpendReservation,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockLogRequest: vi.fn(),
  mockExpandSpendReservation: vi.fn(),
  mockRefundSpendReservation: vi.fn(),
  mockReserveSpend: vi.fn(),
  mockResolveEmbeddingModel: vi.fn(),
  mockSettleSpendReservation: vi.fn(),
}));

vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeySpendLedgerUnavailableError extends Error {
    constructor() {
      super("API key spend ledger unavailable");
      this.name = "ApiKeySpendLedgerUnavailableError";
    }
  }
  class ApiKeySpendLimitExceededError extends Error {
    constructor() {
      super("API key spend limit exceeded");
      this.name = "ApiKeySpendLimitExceededError";
    }
  }

  return {
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
  };
});
vi.mock("../../../src/middleware/logger", () => {
  class RequestLoggingUnavailableError extends Error {
    constructor() {
      super("request logging unavailable");
      this.name = "RequestLoggingUnavailableError";
    }
  }

  return {
    RequestLoggingUnavailableError,
    logRequest: mockLogRequest,
  };
});
vi.mock("../../../src/providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  resolveEmbeddingModel: mockResolveEmbeddingModel,
}));
vi.mock("../../../src/modules/relay/billing", () => ({
  expandSpendReservation: mockExpandSpendReservation,
  refundSpendReservation: mockRefundSpendReservation,
  reserveSpend: mockReserveSpend,
  settleSpendReservation: mockSettleSpendReservation,
}));

import {
  ApiKeyUnbillableEmbeddingUsageError,
  handleEmbedding,
} from "../../../src/modules/embeddings/services";
import type { EmbeddingRequest } from "../../../src/providers/types";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";
import {
  EmbeddingsRelayClientAbortError,
  EmbeddingsRelayProtocolError,
  EmbeddingsRelayTimeoutError,
} from "../../../src/modules/embeddings/relay/errors";
import { readEmbeddingsRelayConfig } from "../../../src/modules/embeddings/relay/config";

describe("embeddings services", () => {
  beforeEach(() => {
    mockReserveSpend.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (overrides?: Partial<EmbeddingRequest>): EmbeddingRequest => ({
    model: "openai:text-embedding-3-small",
    input: "hello",
    ...overrides,
  });

  const createResponse = (model: string, promptTokens = 5) => ({
    object: "list" as const,
    data: [{ object: "embedding" as const, embedding: [0.1, 0.2], index: 0 }],
    model,
    usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    createEmbedding = vi.fn().mockResolvedValue(createResponse(modelId)),
  ) => ({
    provider: {
      name: provider,
      createEmbedding,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("throws when no embedding-capable provider resolves", async () => {
    mockResolveEmbeddingModel.mockResolvedValueOnce(null);

    await expect(handleEmbedding(createRequest({ model: "unknown" }), "key-1")).rejects.toThrow(
      "No provider found",
    );
  });

  it("creates embeddings, logs usage, and returns the requested model id", async () => {
    const createEmbedding = vi.fn().mockResolvedValueOnce(createResponse("text-embedding-3-small"));
    const target = createResolvedModel("openai", "text-embedding-3-small", createEmbedding);
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.000001);

    const result = await handleEmbedding(createRequest(), "key-1");

    expect(result.response.model).toBe("openai:text-embedding-3-small");
    expect(result.status).toBe(200);
    expect(createEmbedding).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: "hello" },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onResponse: expect.any(Function),
      }),
    );
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:text-embedding-3-small", 5, 0);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/embeddings",
        model: "openai:text-embedding-3-small",
        promptTokens: 5,
        totalTokens: 5,
        estimatedCost: 0.000001,
        statusCode: 200,
      }),
    );
  });

  it("preserves provider-specific passthrough fields while rewriting the upstream model", async () => {
    const createEmbedding = vi.fn().mockResolvedValueOnce(createResponse("embed"));
    const target = createResolvedModel("custom", "embed", createEmbedding);
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "custom:embed",
      targets: [target],
    });

    await handleEmbedding(
      createRequest({
        model: "custom:embed",
        seed: 7,
        top_p: 0.5,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
      }),
      "key-1",
    );

    expect(createEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "embed",
        seed: 7,
        top_p: 0.5,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("records spend for limited successful requests", async () => {
    const target = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockResolvedValueOnce(createResponse("text-embedding-3-small", 10)),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "fast-embed",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "text-embedding-3-small" });
    mockEstimateCost.mockReturnValueOnce(0.000002);

    const result = await handleEmbedding(createRequest({ model: "fast-embed" }), "key-1", {
      requireBillableUsage: true,
    });

    expect(result.response.model).toBe("fast-embed");
    expect(mockGetModelPricing).toHaveBeenCalledWith("openai:text-embedding-3-small");
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:text-embedding-3-small", 10, 0);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.000002);
  });

  it("fails before upstream dispatch when a direct limited request has no pricing", async () => {
    const createEmbedding = vi.fn();
    const target = createResolvedModel("openai", "text-embedding-3-small", createEmbedding);
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValueOnce(null);

    await expect(
      handleEmbedding(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableEmbeddingUsageError);
    expect(createEmbedding).not.toHaveBeenCalled();
  });

  it("rejects when limited usage cannot be estimated after a provider response", async () => {
    const target = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockResolvedValueOnce(createResponse("text-embedding-3-small", 10)),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "text-embedding-3-small" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleEmbedding(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableEmbeddingUsageError);
    expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
  });

  it("falls back across embedding-capable targets and returns the requested model id", async () => {
    const primary = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockRejectedValueOnce(new Error("rate limited")),
    );
    const backup = createResolvedModel(
      "custom",
      "embed",
      vi.fn().mockResolvedValueOnce(createResponse("embed", 7)),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "embed",
      name: "Embed",
      description: null,
      requestedModelId: "mux:embed",
      targets: [primary, backup],
    });
    mockEstimateCost.mockReturnValueOnce(0.000003);

    const result = await handleEmbedding(createRequest({ model: "mux:embed" }), "key-1");

    expect(result.response.model).toBe("mux:embed");
    expect(primary.provider.createEmbedding).toHaveBeenCalled();
    expect(backup.provider.createEmbedding).toHaveBeenCalled();
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:text-embedding-3-small", statusCode: 502 }),
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom:embed", statusCode: 200 }),
    );
  });

  it("does not retry non-retryable upstream statuses", async () => {
    const primary = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockRejectedValueOnce(
        new UpstreamOpenAICompatibleError({
          provider: "OpenAI",
          status: 400,
          body: JSON.stringify({ error: { message: "bad input" } }),
        }),
      ),
    );
    const backup = createResolvedModel("custom", "embed");
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [primary, backup],
    });

    await expect(handleEmbedding(createRequest(), "key-1")).rejects.toMatchObject({
      status: 400,
    });
    expect(backup.provider.createEmbedding).not.toHaveBeenCalled();
  });

  it("retries malformed successful responses on another target", async () => {
    const primary = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockResolvedValueOnce({ object: "list", model: "bad", data: [{ index: 0 }] }),
    );
    const backup = createResolvedModel("custom", "embed");
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [primary, backup],
    });
    mockEstimateCost.mockReturnValueOnce(0.000001);

    const result = await handleEmbedding(createRequest(), "key-1");
    expect(result.response.model).toBe("openai:text-embedding-3-small");
    expect(backup.provider.createEmbedding).toHaveBeenCalled();
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 502,
        errorMessage: expect.stringContaining("malformed"),
      }),
    );
  });

  it("returns the captured upstream status and headers", async () => {
    const createEmbedding = vi.fn(
      async (
        _request: EmbeddingRequest,
        options?: { onResponse?: (response: Response) => void },
      ) => {
        options?.onResponse?.(
          new Response(null, { status: 201, headers: { "x-upstream-limit": "42" } }),
        );
        return createResponse("text-embedding-3-small");
      },
    );
    const target = createResolvedModel("openai", "text-embedding-3-small", createEmbedding);
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.000001);

    const result = await handleEmbedding(createRequest(), "key-1");
    expect(result.status).toBe(201);
    expect(result.headers.get("x-upstream-limit")).toBe("42");
  });

  it("falls back to the request estimate when upstream usage is omitted", async () => {
    const target = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: "text-embedding-3-small",
      }),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.000001);

    await handleEmbedding(createRequest(), "key-1");
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:text-embedding-3-small", 1, 0);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: 1, totalTokens: 1 }),
    );
  });

  it("aborts and reports an upstream timeout", async () => {
    let attemptSignal: AbortSignal | undefined;
    const createEmbedding = vi.fn(
      (_request: EmbeddingRequest, options?: { signal?: AbortSignal }) => {
        attemptSignal = options?.signal;
        return new Promise<ReturnType<typeof createResponse>>(() => undefined);
      },
    );
    const target = createResolvedModel("openai", "text-embedding-3-small", createEmbedding);
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });

    await expect(
      handleEmbedding(createRequest(), "key-1", {
        config: {
          ...readEmbeddingsRelayConfig({}),
          retryCount: 0,
          nonStreamTimeoutMs: 5,
        },
      }),
    ).rejects.toBeInstanceOf(EmbeddingsRelayTimeoutError);
    expect(attemptSignal?.aborted).toBe(true);
  });

  it("does not fail over after the client aborts", async () => {
    const primary = createResolvedModel("openai", "text-embedding-3-small");
    const backup = createResolvedModel("custom", "embed");
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [primary, backup],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      handleEmbedding(createRequest(), "key-1", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(EmbeddingsRelayClientAbortError);
    expect(backup.provider.createEmbedding).not.toHaveBeenCalled();
  });

  it("rejects a float response containing base64 embeddings", async () => {
    const target = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [{ object: "embedding", embedding: "AAAA", index: 0 }],
        model: "text-embedding-3-small",
      }),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });

    await expect(
      handleEmbedding(createRequest(), "key-1", {
        config: { ...readEmbeddingsRelayConfig({}), retryCount: 0 },
      }),
    ).rejects.toBeInstanceOf(EmbeddingsRelayProtocolError);
  });

  it("reserves and settles limited spend using actual upstream usage", async () => {
    const reservation = {
      requestId: "req-1",
      limits: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      reservedUsd: 0.00001,
    };
    const target = createResolvedModel("openai", "text-embedding-3-small");
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValue({ id: "text-embedding-3-small" });
    mockEstimateCost.mockReturnValueOnce(0.00001).mockReturnValueOnce(0.000005);
    mockReserveSpend.mockResolvedValueOnce(reservation);

    await handleEmbedding(createRequest(), "key-1", {
      requireBillableUsage: true,
      billing: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      requestId: "req-1",
    });

    expect(mockReserveSpend).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: "key-1" }),
      "req-1",
      0.00001,
    );
    expect(mockSettleSpendReservation).toHaveBeenCalledWith(reservation, 0.000005);
    expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
  });

  it("refunds a pending reservation after terminal upstream failure", async () => {
    const reservation = {
      requestId: "req-1",
      limits: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      reservedUsd: 0.00001,
    };
    const target = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi
        .fn()
        .mockRejectedValueOnce(
          new UpstreamOpenAICompatibleError({ provider: "OpenAI", status: 400, body: "{}" }),
        ),
    );
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-embedding-3-small",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValue({ id: "text-embedding-3-small" });
    mockEstimateCost.mockReturnValueOnce(0.00001);
    mockReserveSpend.mockResolvedValueOnce(reservation);

    await expect(
      handleEmbedding(createRequest(), "key-1", {
        requireBillableUsage: true,
        billing: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockRefundSpendReservation).toHaveBeenCalledWith(reservation);
  });

  it("expands a reservation when failover selects a more expensive target", async () => {
    const reservation = {
      requestId: "req-1",
      limits: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      reservedUsd: 0.00001,
    };
    const primary = createResolvedModel(
      "openai",
      "text-embedding-3-small",
      vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")),
    );
    const backup = createResolvedModel("custom", "embed");
    mockResolveEmbeddingModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "mux:embed",
      targets: [primary, backup],
    });
    mockGetModelPricing.mockReturnValue({ id: "embedding" });
    mockEstimateCost
      .mockReturnValueOnce(0.00001)
      .mockReturnValueOnce(0.00002)
      .mockReturnValueOnce(0.000015);
    mockReserveSpend.mockResolvedValueOnce(reservation);

    await handleEmbedding(createRequest({ model: "mux:embed" }), "key-1", {
      requireBillableUsage: true,
      billing: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      requestId: "req-1",
    });

    expect(mockExpandSpendReservation).toHaveBeenCalledWith(reservation, 0.00002);
    expect(mockSettleSpendReservation).toHaveBeenCalledWith(reservation, 0.000015);
  });
});
