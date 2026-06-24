import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockGetProviderByName,
  mockLogRequest,
  mockResolveChatModel,
  mockResolveResponseTarget,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockGetProviderByName: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveChatModel: vi.fn(),
  mockResolveResponseTarget: vi.fn(),
}));

vi.mock("../keys/services", () => {
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
vi.mock("../../middleware/logger", () => {
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
vi.mock("../../providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  getProviderByName: mockGetProviderByName,
  resolveChatModel: mockResolveChatModel,
  resolveResponseTarget: mockResolveResponseTarget,
}));

import {
  ApiKeyUnbillableResponseUsageError,
  handleResponseCreate,
  handleResponseCreateStream,
  handleResponseDelete,
  handleResponseRetrieve,
  OpenAIResponseProviderNotConfiguredError,
  UnsupportedResponseFeatureError,
} from "./services";
import { openAICompatibleCapabilities } from "../../providers/chat-compat";
import type { ResponseCreateRequest } from "../../providers/types";

describe("responses services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (overrides?: Partial<ResponseCreateRequest>): ResponseCreateRequest => ({
    model: "openai:gpt-4o",
    input: "hello",
    ...overrides,
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    createResponse = vi.fn(),
    createResponseStream = vi.fn(),
  ) => ({
    provider: {
      name: provider,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      createResponse,
      createResponseStream,
      listModels: vi.fn().mockReturnValue([
        {
          id: modelId,
          name: modelId,
          provider,
          inputPricePer1M: 1,
          outputPricePer1M: 1,
          contextWindow: 1,
          maxOutputTokens: 1,
          inputModalities: ["text"],
          outputModalities: ["text"],
          reasoning: true,
          toolCall: true,
          structuredOutput: true,
          weights: "closed",
        },
      ]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("calls OpenAI response create, logs request, and rewrites model", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleResponseCreate(
      createRequest({ text: { format: { type: "text" } }, unknown: true }),
      "key-1",
    );

    expect(result).toMatchObject({ id: "resp-1", model: "openai:gpt-4o" });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
        text: { format: { type: "text" } },
      }),
    );
    expect(createResponse.mock.calls[0]?.[0]).not.toHaveProperty("unknown");
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses",
        model: "openai:gpt-4o",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("rejects unsupported response features before resolving providers", async () => {
    await expect(handleResponseCreate(createRequest({ stream: true }), "key-1")).rejects.toThrow(
      "streaming",
    );
    await expect(
      handleResponseCreate(createRequest({ background: true }), "key-1"),
    ).rejects.toThrow("background");
    expect(mockResolveResponseTarget).not.toHaveBeenCalled();
  });

  it("returns raw response streams for direct OpenAI models", async () => {
    async function* stream() {
      yield 'event: response.completed\ndata: {"type":"response.completed"}\n\n';
    }

    const createResponseStream = vi.fn().mockReturnValue(stream());
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", vi.fn(), createResponseStream),
    });

    const result = await handleResponseCreateStream(createRequest({ stream: true }));
    expect(result).toMatchObject({ provider: "openai", model: "openai:gpt-4o" });
    expect(createResponseStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o", input: "hello", stream: true }),
    );

    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['event: response.completed\ndata: {"type":"response.completed"}\n\n']);
  });

  it("routes through any Responses-capable provider (e.g. Azure)", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-5",
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "azure-cognitive-services:gpt-5",
      target: createResolvedModel("azure-cognitive-services", "gpt-5", createResponse),
    });

    const result = await handleResponseCreate(
      createRequest({ model: "azure-cognitive-services:gpt-5" }),
      "key-1",
    );

    expect(result).toMatchObject({
      id: "resp-1",
      model: "azure-cognitive-services:gpt-5",
    });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5" }),
    );
  });

  it("routes through a fallback-group target that is Responses-capable", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "fallback-group",
      requestedModelId: "mux:fast",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });

    const result = await handleResponseCreate(
      createRequest({ model: "mux:fast" }),
      "key-1",
    );

    expect(result).toMatchObject({ id: "resp-1", model: "mux:fast" });
  });

  it("rejects a model that resolves but is not Responses-capable", async () => {
    mockResolveResponseTarget.mockResolvedValueOnce(null);
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude",
      targets: [createResolvedModel("anthropic", "claude")],
    });

    await expect(
      handleResponseCreate(createRequest({ model: "anthropic:claude" }), "key-1"),
    ).rejects.toBeInstanceOf(UnsupportedResponseFeatureError);
  });

  it("rejects a fallback group with no Responses-capable targets", async () => {
    mockResolveResponseTarget.mockResolvedValueOnce(null);
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "anthropic-only",
      name: "Anthropic only",
      description: null,
      requestedModelId: "mux:anthropic-only",
      targets: [createResolvedModel("anthropic", "claude")],
    });

    await expect(
      handleResponseCreate(createRequest({ model: "mux:anthropic-only" }), "key-1"),
    ).rejects.toBeInstanceOf(UnsupportedResponseFeatureError);
  });

  it("throws when the model does not resolve to any provider", async () => {
    mockResolveResponseTarget.mockResolvedValueOnce(null);
    mockResolveChatModel.mockResolvedValueOnce(null);

    await expect(
      handleResponseCreate(createRequest({ model: "openai:gpt-4o" }), "key-1"),
    ).rejects.toThrow("No provider found");
  });

  it("records spend for limited successful requests", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4o" });
    mockEstimateCost.mockReturnValueOnce(0.01);

    await handleResponseCreate(createRequest(), "key-1", { requireBillableUsage: true });

    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
  });

  it("throws when limited key request cannot be billed", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4o" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleResponseCreate(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableResponseUsageError);
  });

  it("retrieves a response via the openai provider and logs a 200 entry", async () => {
    const getResponse = vi.fn().mockResolvedValueOnce({
      id: "resp_abc",
      object: "response",
      status: "completed",
      model: "gpt-4o-2024-08-06",
    });
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseRetrieve("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc" });
    expect(getResponse).toHaveBeenCalledWith("resp_abc", undefined);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key-1",
        provider: "openai",
        endpoint: "/v1/responses/:id",
        statusCode: 200,
      }),
    );
  });

  it("throws when the openai provider is not configured", async () => {
    mockGetProviderByName.mockReturnValueOnce(null);

    await expect(handleResponseRetrieve("resp_abc", "key-1")).rejects.toBeInstanceOf(
      OpenAIResponseProviderNotConfiguredError,
    );
    expect(mockLogRequest).not.toHaveBeenCalled();
  });

  it("rejects providers that do not implement getResponse", async () => {
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseRetrieve("resp_abc", "key-1")).rejects.toBeInstanceOf(
      UnsupportedResponseFeatureError,
    );
  });

  it("logs upstream errors before rethrowing", async () => {
    const getResponse = vi
      .fn()
      .mockRejectedValueOnce(new Error("OpenAI Responses API error: 404 - not found"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseRetrieve("resp_abc", "key-1")).rejects.toThrow(
      "OpenAI Responses API error: 404",
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 500,
        errorMessage: expect.stringContaining("404"),
      }),
    );
  });

  it("forwards query params to the openai provider on retrieve", async () => {
    const getResponse = vi.fn().mockResolvedValueOnce({ id: "resp_abc" });
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await handleResponseRetrieve("resp_abc", "key-1", { include: ["file_search_call.results"] });

    expect(getResponse).toHaveBeenCalledWith("resp_abc", { include: ["file_search_call.results"] });
  });

  it("deletes a response via the openai provider and logs a 200 entry", async () => {
    const deleteResponse = vi.fn().mockResolvedValueOnce({
      id: "resp_abc",
      object: "response",
      deleted: true,
    });
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      deleteResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseDelete("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc", deleted: true });
    expect(deleteResponse).toHaveBeenCalledWith("resp_abc");
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key-1",
        provider: "openai",
        endpoint: "/v1/responses/:id",
        statusCode: 200,
      }),
    );
  });

  it("throws when the openai provider is not configured for delete", async () => {
    mockGetProviderByName.mockReturnValueOnce(null);

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toBeInstanceOf(
      OpenAIResponseProviderNotConfiguredError,
    );
    expect(mockLogRequest).not.toHaveBeenCalled();
  });

  it("rejects providers that do not implement deleteResponse", async () => {
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toBeInstanceOf(
      UnsupportedResponseFeatureError,
    );
  });

  it("logs upstream errors before rethrowing on delete", async () => {
    const deleteResponse = vi
      .fn()
      .mockRejectedValueOnce(new Error("OpenAI Responses API error: 404 - not found"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      deleteResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toThrow(
      "OpenAI Responses API error: 404",
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 500,
        errorMessage: expect.stringContaining("404"),
      }),
    );
  });
});
