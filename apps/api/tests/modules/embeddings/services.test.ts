import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockLogRequest,
  mockResolveEmbeddingModel,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveEmbeddingModel: vi.fn(),
}));

vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeySpendLedgerUnavailableError extends Error {
    constructor() {
      super("API key spend ledger unavailable");
      this.name = "ApiKeySpendLedgerUnavailableError";
    }
  }

  return {
    ApiKeySpendLedgerUnavailableError,
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

import {
  ApiKeyUnbillableEmbeddingUsageError,
  handleEmbedding,
} from "../../../src/modules/embeddings/services";
import type { EmbeddingRequest } from "../../../src/providers/types";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";

describe("embeddings services", () => {
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

    const response = await handleEmbedding(createRequest(), "key-1");

    expect(response.model).toBe("openai:text-embedding-3-small");
    expect(createEmbedding).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "hello",
    });
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

    const response = await handleEmbedding(createRequest({ model: "fast-embed" }), "key-1", {
      requireBillableUsage: true,
    });

    expect(response.model).toBe("fast-embed");
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

  it("logs and rejects when limited usage cannot be estimated after a provider response", async () => {
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
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/embeddings",
        statusCode: 429,
        errorMessage: "Billable usage could not be determined",
      }),
    );
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

    const response = await handleEmbedding(createRequest({ model: "mux:embed" }), "key-1");

    expect(response.model).toBe("mux:embed");
    expect(primary.provider.createEmbedding).toHaveBeenCalled();
    expect(backup.provider.createEmbedding).toHaveBeenCalled();
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:text-embedding-3-small", statusCode: 500 }),
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom:embed", statusCode: 200 }),
    );
  });
});
