import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockBackoffMs,
  mockEnqueueBackgroundPoll,
  mockEstimateCost,
  mockGetModelPricing,
  mockGetProviderChannelRuntime,
  mockGetProviderForChannel,
  mockGetProviderByName,
  mockIsResponsesCacheEnabled,
  mockLogRequest,
  mockPrismaBackgroundResponseJobCreate,
  mockPrismaBackgroundResponseJobDelete,
  mockPrismaBackgroundResponseJobFindUnique,
  mockPrismaBackgroundResponseJobUpdate,
  mockReadCachedResponse,
  mockResolveChatModel,
  mockResolveResponseTarget,
  mockWriteCachedResponse,
  mockGetResponsesCacheTtlSeconds,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockBackoffMs: vi.fn(),
  mockEnqueueBackgroundPoll: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockGetProviderChannelRuntime: vi.fn(),
  mockGetProviderForChannel: vi.fn(),
  mockGetProviderByName: vi.fn(),
  mockIsResponsesCacheEnabled: vi.fn(),
  mockLogRequest: vi.fn(),
  mockPrismaBackgroundResponseJobCreate: vi.fn(),
  mockPrismaBackgroundResponseJobDelete: vi.fn(),
  mockPrismaBackgroundResponseJobFindUnique: vi.fn(),
  mockPrismaBackgroundResponseJobUpdate: vi.fn(),
  mockReadCachedResponse: vi.fn(),
  mockResolveChatModel: vi.fn(),
  mockResolveResponseTarget: vi.fn(),
  mockWriteCachedResponse: vi.fn(),
  mockGetResponsesCacheTtlSeconds: vi.fn(),
}));

vi.mock("@repo/worker", () => ({
  backoffMs: mockBackoffMs,
  enqueueBackgroundPoll: mockEnqueueBackgroundPoll,
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
  getProviderChannelRuntime: mockGetProviderChannelRuntime,
  getProviderForChannel: mockGetProviderForChannel,
  getProviderByName: mockGetProviderByName,
  resolveChatModel: mockResolveChatModel,
  resolveResponseTarget: mockResolveResponseTarget,
}));
vi.mock("../../../src/utils/prisma", () => ({
  prisma: {
    backgroundResponseJob: {
      create: mockPrismaBackgroundResponseJobCreate,
      delete: mockPrismaBackgroundResponseJobDelete,
      findUnique: mockPrismaBackgroundResponseJobFindUnique,
      update: mockPrismaBackgroundResponseJobUpdate,
    },
  },
}));

vi.mock("../../../src/providers/responses-cache", () => ({
  isResponsesCacheEnabled: mockIsResponsesCacheEnabled,
  getResponsesCacheTtlSeconds: mockGetResponsesCacheTtlSeconds,
  readCachedResponse: mockReadCachedResponse,
  writeCachedResponse: mockWriteCachedResponse,
}));

import {
  ApiKeyUnbillableResponseUsageError,
  handleResponseCancel,
  handleResponseCompact,
  handleResponseCreate,
  handleResponseCreateStream,
  handleResponseDelete,
  handleResponseInputItems,
  handleResponseInputTokens,
  handleResponseRetrieve,
  OpenAIResponseProviderNotConfiguredError,
  ResponseNotFoundError,
  submitBackgroundResponse,
  UnsupportedResponseFeatureError,
} from "../../../src/modules/responses/services";
import { UpstreamResponsesApiError } from "../../../src/providers/openai";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import type { ResponseCreateRequest } from "../../../src/providers/types";

describe("responses services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsResponsesCacheEnabled.mockReturnValue(false);
    mockGetProviderChannelRuntime.mockReturnValue(null);
    mockGetProviderForChannel.mockImplementation((provider: string) =>
      mockGetProviderByName(provider),
    );
    mockReadCachedResponse.mockResolvedValue(null);
    mockWriteCachedResponse.mockResolvedValue(undefined);
    mockGetResponsesCacheTtlSeconds.mockReturnValue(300);
    mockBackoffMs.mockReturnValue(2_000);
    mockEnqueueBackgroundPoll.mockResolvedValue(undefined);
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
    compactResponse = vi.fn(),
  ) => ({
    provider: {
      name: provider,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      createResponse,
      createResponseStream,
      compactResponse,
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
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-4o", 10, 20, undefined);
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

  it("applies channel body and header overrides before creating a response", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-override",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: {
        ...createResolvedModel("openai", "gpt-4o", createResponse),
        apiKey: "sk-upstream",
        headerOverride: {
          "X-Key": "{api_key}",
          "X-Trace": "{client_header:X-Trace}",
        },
        paramOverride: { metadata: { channel: "primary" } },
      },
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    await handleResponseCreate(createRequest(), "key-1", {
      requestContext: { clientHeaders: new Headers({ "X-Trace": "trace-123" }) },
    });

    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        metadata: { channel: "primary" },
      }),
      {
        headers: {
          "x-key": "sk-upstream",
          "x-trace": "trace-123",
        },
      },
    );
  });

  it("passes the original raw body for pass-through response channels", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-raw",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const rawBody = '{\n  "model": "openai:gpt-4o",\n  "input": "hello"\n}';
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: {
        ...createResolvedModel("openai", "gpt-4o", createResponse),
        settings: { passThroughBodyEnabled: true },
        paramOverride: { metadata: { channel: "primary" } },
      },
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    await handleResponseCreate(createRequest({ unknown: true }), "key-1", { rawBody });

    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
      }),
      { headers: {}, rawBody },
    );
  });

  it("forwards cached_tokens to estimateCost when upstream reports them", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-cached",
      model: "gpt-5",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 80 },
      },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-5",
      target: createResolvedModel("openai", "gpt-5", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.000625);

    await handleResponseCreate(createRequest({ model: "openai:gpt-5" }), "key-1");

    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-5", 100, 50, 80);
  });

  it("logs reasoning_tokens when upstream reports them via output_tokens_details", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-reasoning",
      model: "gpt-5",
      usage: {
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        output_tokens_details: { reasoning_tokens: 42 },
      },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-5",
      target: createResolvedModel("openai", "gpt-5", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.001);

    await handleResponseCreate(createRequest({ model: "openai:gpt-5" }), "key-1");

    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        reasoningTokens: 42,
        estimatedCost: 0.001,
        statusCode: 200,
      }),
    );
  });

  it("filters stream_options.include_obfuscation by default", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-stream-options",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.000002);

    await handleResponseCreate(
      createRequest({
        stream_options: { include_obfuscation: true },
      }),
      "key-1",
    );

    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
      }),
    );
    expect(createResponse.mock.calls[0]?.[0]).not.toHaveProperty("stream_options");
  });

  it("forwards include array entries verbatim on Responses create", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-include",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.000002);

    await handleResponseCreate(
      createRequest({
        include: ["file_search_call.results", "reasoning.encrypted_content"],
      }),
      "key-1",
    );

    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
        include: ["file_search_call.results", "reasoning.encrypted_content"],
      }),
    );
  });

  it("forwards remaining Responses passthrough fields on create", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-context",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4o",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockEstimateCost.mockReturnValueOnce(0.000002);

    await handleResponseCreate(
      createRequest({
        context_management: { truncation: "auto" },
        enable_thinking: false,
        prompt_cache_retention: { type: "ephemeral" },
        preset: "sonar",
      }),
      "key-1",
    );

    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
        context_management: { truncation: "auto" },
        enable_thinking: false,
        prompt_cache_retention: { type: "ephemeral" },
        preset: "sonar",
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

    const result = await handleResponseCreateStream(createRequest({ stream: true }), "key-1");
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

  describe("submitBackgroundResponse", () => {
    it("persists a job keyed by upstream id and returns the upstream body", async () => {
      const createResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_abc",
        object: "response",
        status: "queued",
        model: "gpt-5",
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });
      mockGetModelPricing.mockReturnValueOnce({
        id: "gpt-5",
        inputPricePer1M: 1.25,
        outputPricePer1M: 10,
      });
      mockPrismaBackgroundResponseJobCreate.mockResolvedValueOnce({ id: "resp_bg_abc" });

      const result = await submitBackgroundResponse(
        createRequest({ model: "openai:gpt-5", background: true }),
        "key-1",
      );

      expect(result).toEqual({
        id: "resp_bg_abc",
        response: {
          id: "resp_bg_abc",
          object: "response",
          status: "queued",
          model: "openai:gpt-5",
        },
      });
      expect(mockPrismaBackgroundResponseJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: "resp_bg_abc",
            apiKeyId: "key-1",
            provider: "openai",
            model: "openai:gpt-5",
            status: "queued",
            inputPricePer1M: 1.25,
            outputPricePer1M: 10,
          }),
        }),
      );
      const createCall = mockPrismaBackgroundResponseJobCreate.mock.calls[0]?.[0] as {
        data: { request: Record<string, unknown>; response: Record<string, unknown> };
      };
      expect(createCall.data.request).toMatchObject({ model: "openai:gpt-5", background: true });
      expect(createCall.data.response).toMatchObject({ id: "resp_bg_abc", status: "queued" });
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses",
          provider: "openai",
          model: "openai:gpt-5",
          statusCode: 202,
        }),
      );
      expect(mockEnqueueBackgroundPoll).toHaveBeenCalledWith("resp_bg_abc", 1, 2_000);
      expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
    });

    it("does not enqueue polling for terminal upstream responses", async () => {
      const createResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_done",
        object: "response",
        status: "completed",
        model: "gpt-5",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });
      mockGetModelPricing.mockReturnValueOnce({
        id: "gpt-5",
        inputPricePer1M: 1.25,
        outputPricePer1M: 10,
      });
      mockEstimateCost.mockReturnValueOnce(0.000325);
      mockPrismaBackgroundResponseJobCreate.mockResolvedValueOnce({ id: "resp_bg_done" });

      await submitBackgroundResponse(createRequest({ background: true }), "key-1");

      expect(mockEnqueueBackgroundPoll).not.toHaveBeenCalled();
      expect(mockPrismaBackgroundResponseJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "completed",
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedCost: 0.000325,
          promptTokens: 100,
          completionTokens: 20,
        }),
      );
    });

    it("requires known pricing for spend-limited background submissions", async () => {
      const createResponse = vi.fn();
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });
      mockGetModelPricing.mockReturnValueOnce(null);

      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1", {
          requireBillableUsage: true,
        }),
      ).rejects.toBeInstanceOf(ApiKeyUnbillableResponseUsageError);
      expect(createResponse).not.toHaveBeenCalled();
      expect(mockPrismaBackgroundResponseJobCreate).not.toHaveBeenCalled();
    });

    it("does not write a row when the upstream call fails", async () => {
      const createResponse = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });

      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1"),
      ).rejects.toBeInstanceOf(UpstreamResponsesApiError);
      expect(mockPrismaBackgroundResponseJobCreate).not.toHaveBeenCalled();
      expect(mockLogRequest).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    });

    it("throws when the model does not resolve", async () => {
      mockResolveResponseTarget.mockResolvedValueOnce(null);
      mockResolveChatModel.mockResolvedValueOnce(null);

      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1"),
      ).rejects.toThrow("No provider found");
      expect(mockPrismaBackgroundResponseJobCreate).not.toHaveBeenCalled();
    });

    it("rejects a model that is not Responses-capable", async () => {
      mockResolveResponseTarget.mockResolvedValueOnce(null);
      mockResolveChatModel.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "anthropic:claude",
        targets: [createResolvedModel("anthropic", "claude")],
      });

      await expect(
        submitBackgroundResponse(createRequest({ model: "anthropic:claude" }), "key-1"),
      ).rejects.toBeInstanceOf(UnsupportedResponseFeatureError);
      expect(mockPrismaBackgroundResponseJobCreate).not.toHaveBeenCalled();
    });

    it("falls back to status 'queued' when the upstream response omits status", async () => {
      const createResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_xyz",
        object: "response",
        model: "gpt-5",
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });
      mockGetModelPricing.mockReturnValueOnce({
        id: "gpt-5",
        inputPricePer1M: 1.25,
        outputPricePer1M: 10,
      });
      mockPrismaBackgroundResponseJobCreate.mockResolvedValueOnce({ id: "resp_bg_xyz" });

      const result = await submitBackgroundResponse(createRequest({ background: true }), "key-1");

      expect(result.id).toBe("resp_bg_xyz");
      expect(mockPrismaBackgroundResponseJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "queued" }),
        }),
      );
      expect(mockEnqueueBackgroundPoll).toHaveBeenCalledWith("resp_bg_xyz", 1, 2_000);
    });
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
    expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5" }));
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

    const result = await handleResponseCreate(createRequest({ model: "mux:fast" }), "key-1");

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

  it("uses concrete target pricing while returning the requested alias", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce({
      id: "resp-1",
      model: "gpt-4o",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    mockResolveResponseTarget.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "fast-chat",
      target: createResolvedModel("openai", "gpt-4o", createResponse),
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4o" });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleResponseCreate(createRequest({ model: "fast-chat" }), "key-1", {
      requireBillableUsage: true,
    });

    expect(result).toMatchObject({ id: "resp-1", model: "fast-chat" });
    expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
    expect(mockGetModelPricing).toHaveBeenCalledWith("openai:gpt-4o");
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-4o", 10, 20, undefined);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-4o", statusCode: 200 }),
    );
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

  it("returns the local row response when a BackgroundResponseJob exists", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_abc",
      apiKeyId: "key-1",
      provider: "openai",
      model: "openai:gpt-5",
      status: "completed",
      response: { id: "resp_bg_abc", status: "completed", model: "gpt-5" },
    });

    const result = await handleResponseRetrieve("resp_bg_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_bg_abc", status: "completed" });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        provider: "openai",
        model: "openai:gpt-5",
        statusCode: 200,
      }),
    );
  });

  it("returns a synthesized pending envelope when a BackgroundResponseJob has no response yet", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_xyz",
      apiKeyId: "key-1",
      provider: "openai",
      model: "openai:gpt-5",
      status: "queued",
      response: null,
    });

    const result = await handleResponseRetrieve("resp_bg_xyz", "key-1");

    expect(result).toMatchObject({
      id: "resp_bg_xyz",
      status: "queued",
      _pending: true,
    });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 202,
      }),
    );
  });

  it("returns stored local background body as pending when the job is not terminal", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_pending",
      apiKeyId: "key-1",
      provider: "openai",
      model: "openai:gpt-5",
      status: "in_progress",
      response: { id: "resp_bg_pending", status: "queued", model: "gpt-5" },
    });

    const result = await handleResponseRetrieve("resp_bg_pending", "key-1");

    expect(result).toMatchObject({
      id: "resp_bg_pending",
      status: "in_progress",
      model: "openai:gpt-5",
      _pending: true,
    });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 202,
      }),
    );
  });

  it("falls through to the OpenAI provider when no local row exists", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    const getResponse = vi.fn().mockResolvedValueOnce({ id: "resp_abc" });
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseRetrieve("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc" });
    expect(getResponse).toHaveBeenCalledWith("resp_abc", undefined);
  });

  it("returns the cached response without calling upstream when cache hits", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValue(null);
    mockIsResponsesCacheEnabled.mockReturnValue(true);
    mockReadCachedResponse.mockResolvedValue({
      id: "resp_abc",
      object: "response",
      _fromCache: true,
    });
    const getResponse = vi.fn();
    mockGetProviderByName.mockReturnValue({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseRetrieve("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc", _fromCache: true });
    expect(mockReadCachedResponse).toHaveBeenCalledWith("key-1", "openai", "resp_abc");
    expect(getResponse).not.toHaveBeenCalled();
  });

  it("writes the upstream response to the cache when enabled and the entry is missing", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    mockIsResponsesCacheEnabled.mockReturnValue(true);
    mockReadCachedResponse.mockResolvedValueOnce(null);
    mockGetResponsesCacheTtlSeconds.mockReturnValue(60);
    const getResponse = vi.fn().mockResolvedValueOnce({ id: "resp_abc", object: "response" });
    mockGetProviderByName.mockReturnValue({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseRetrieve("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc" });
    expect(mockWriteCachedResponse).toHaveBeenCalledWith(
      "key-1",
      "openai",
      "resp_abc",
      { id: "resp_abc", object: "response" },
      60,
    );
  });

  it("does not read or write the cache when the flag is off", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    const getResponse = vi.fn().mockResolvedValueOnce({ id: "resp_abc" });
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleResponseRetrieve("resp_abc", "key-1");

    expect(result).toMatchObject({ id: "resp_abc" });
    expect(mockReadCachedResponse).not.toHaveBeenCalled();
    expect(mockWriteCachedResponse).not.toHaveBeenCalled();
  });

  it("deletes a response via the openai provider and logs a 200 entry", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
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

  it("deletes a local BackgroundResponseJob and tolerates upstream 404", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_abc",
      apiKeyId: "key-1",
      provider: "openai",
      model: "openai:gpt-5",
      status: "cancelled",
      response: { id: "resp_bg_abc", status: "cancelled" },
    });
    const deleteResponse = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      deleteResponse,
      listModels: vi.fn().mockReturnValue([]),
    });
    mockPrismaBackgroundResponseJobDelete.mockResolvedValueOnce({});

    const result = await handleResponseDelete("resp_bg_abc", "key-1");

    expect(result).toMatchObject({
      id: "resp_bg_abc",
      object: "response",
      deleted: true,
    });
    expect(deleteResponse).toHaveBeenCalledWith("resp_bg_abc");
    expect(mockPrismaBackgroundResponseJobDelete).toHaveBeenCalledWith({
      where: { id: "resp_bg_abc" },
    });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        provider: "openai",
        model: "openai:gpt-5",
        statusCode: 200,
      }),
    );
  });

  it("throws when the openai provider is not configured for delete", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    mockGetProviderByName.mockReturnValueOnce(null);

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toBeInstanceOf(
      OpenAIResponseProviderNotConfiguredError,
    );
    expect(mockLogRequest).not.toHaveBeenCalled();
  });

  it("rejects providers that do not implement deleteResponse", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toBeInstanceOf(
      UnsupportedResponseFeatureError,
    );
  });

  it("logs upstream errors before rethrowing on delete", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
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

  describe("handleResponseCancel", () => {
    function makeProvider(name: string, cancelResponse: ReturnType<typeof vi.fn>) {
      return {
        name,
        chatCompletion: vi.fn(),
        chatCompletionStream: vi.fn(),
        cancelResponse,
        listModels: vi.fn().mockReturnValue([]),
        capabilities: openAICompatibleCapabilities,
      };
    }

    it("cancels via OpenAI when configured and logs a 200 entry", async () => {
      const cancelResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_abc",
        object: "response",
        status: "cancelled",
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", cancelResponse) : null,
      );

      const result = await handleResponseCancel("resp_abc", "key-1");
      expect(result).toMatchObject({
        provider: "openai",
        model: "openai",
        response: { id: "resp_abc", status: "cancelled" },
      });
      expect(cancelResponse).toHaveBeenCalledWith("resp_abc");
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/cancel",
          provider: "openai",
          statusCode: 200,
        }),
      );
    });

    it("falls through to Azure when OpenAI returns 404", async () => {
      const openaiCancel = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "not found"));
      const azureCancel = vi.fn().mockResolvedValueOnce({
        id: "resp_abc",
        object: "response",
        status: "cancelled",
      });
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCancel);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCancel);
        return null;
      });

      const result = await handleResponseCancel("resp_abc", "key-1");
      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureCancel).toHaveBeenCalledWith("resp_abc");
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/cancel",
          provider: "azure-cognitive-services",
          statusCode: 200,
        }),
      );
    });

    it("throws ResponseNotFoundError when both providers return 404", async () => {
      const openaiCancel = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      const azureCancel = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCancel);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCancel);
        return null;
      });

      await expect(handleResponseCancel("resp_x", "key-1")).rejects.toBeInstanceOf(
        ResponseNotFoundError,
      );
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/cancel",
          statusCode: 404,
        }),
      );
    });

    it("does not retry Azure when OpenAI returns a non-404 upstream error", async () => {
      const openaiCancel = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureCancel = vi.fn();
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCancel);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCancel);
        return null;
      });

      await expect(handleResponseCancel("resp_x", "key-1")).rejects.toBeInstanceOf(
        UpstreamResponsesApiError,
      );
      expect(azureCancel).not.toHaveBeenCalled();
    });

    it("throws OpenAIResponseProviderNotConfiguredError when no adapter implements cancel", async () => {
      mockGetProviderByName.mockReturnValue(null);

      await expect(handleResponseCancel("resp_x", "key-1")).rejects.toBeInstanceOf(
        OpenAIResponseProviderNotConfiguredError,
      );
    });

    it("cancels a local BackgroundResponseJob and updates the row", async () => {
      mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
        id: "resp_bg_abc",
        apiKeyId: "key-1",
        provider: "openai",
        model: "openai:gpt-5",
        status: "in_progress",
        response: { id: "resp_bg_abc", status: "in_progress" },
      });
      const cancelResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_abc",
        object: "response",
        status: "cancelled",
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", cancelResponse) : null,
      );
      mockPrismaBackgroundResponseJobUpdate.mockResolvedValueOnce({});

      const result = await handleResponseCancel("resp_bg_abc", "key-1");

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai:gpt-5",
        response: { id: "resp_bg_abc", status: "cancelled" },
      });
      expect(cancelResponse).toHaveBeenCalledWith("resp_bg_abc");
      expect(mockPrismaBackgroundResponseJobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "resp_bg_abc" },
          data: expect.objectContaining({
            status: "cancelled",
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/cancel",
          provider: "openai",
          model: "openai:gpt-5",
          statusCode: 200,
        }),
      );
    });

    it("treats upstream 404 on cancel as already cancelled for local row", async () => {
      mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
        id: "resp_bg_abc",
        apiKeyId: "key-1",
        provider: "openai",
        model: "openai:gpt-5",
        status: "queued",
        response: { id: "resp_bg_abc", status: "queued" },
      });
      const cancelResponse = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", cancelResponse) : null,
      );
      mockPrismaBackgroundResponseJobUpdate.mockResolvedValueOnce({});

      const result = await handleResponseCancel("resp_bg_abc", "key-1");

      expect(result.response).toMatchObject({ status: "cancelled" });
      expect(mockPrismaBackgroundResponseJobUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "cancelled",
            errorMessage: "upstream 404 on cancel",
          }),
        }),
      );
    });

    it("marks local row cancelled even when no provider is configured", async () => {
      mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
        id: "resp_bg_abc",
        apiKeyId: "key-1",
        provider: "openai",
        model: "openai:gpt-5",
        status: "queued",
        response: { id: "resp_bg_abc", status: "queued" },
      });
      mockGetProviderByName.mockReturnValue(null);
      mockPrismaBackgroundResponseJobUpdate.mockResolvedValueOnce({});

      const result = await handleResponseCancel("resp_bg_abc", "key-1");

      expect(result.response).toMatchObject({ status: "cancelled" });
      expect(mockPrismaBackgroundResponseJobUpdate).toHaveBeenCalled();
    });

    it("rethrows non-404 upstream errors from cancel on local row", async () => {
      mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
        id: "resp_bg_abc",
        apiKeyId: "key-1",
        provider: "openai",
        model: "openai:gpt-5",
        status: "queued",
        response: { id: "resp_bg_abc", status: "queued" },
      });
      const cancelResponse = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", cancelResponse) : null,
      );

      await expect(handleResponseCancel("resp_bg_abc", "key-1")).rejects.toBeInstanceOf(
        UpstreamResponsesApiError,
      );
      expect(mockPrismaBackgroundResponseJobUpdate).not.toHaveBeenCalled();
    });
  });

  describe("handleResponseCompact", () => {
    function makeProvider(name: string, compactResponse: ReturnType<typeof vi.fn> | undefined) {
      return {
        name,
        chatCompletion: vi.fn(),
        chatCompletionStream: vi.fn(),
        compactResponse,
        listModels: vi.fn().mockReturnValue([
          {
            id: "model-1",
            name: "Model 1",
            provider: name,
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
      };
    }

    it("compacts via the resolved provider, rewrites the model id, and logs spend", async () => {
      const compactResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_001",
        object: "response.compaction",
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), compactResponse),
      });
      mockGetModelPricing.mockReturnValueOnce({ id: "gpt-5" });
      mockEstimateCost.mockReturnValueOnce(0.42);

      const result = await handleResponseCompact(
        {
          model: "openai:gpt-5",
          input: [{ role: "user", content: "hi" }],
          instructions: { text: "preserve tool state" },
          previous_response_id: "resp_prev",
        },
        "key-1",
        { requireBillableUsage: true },
      );

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai:gpt-5",
      });
      expect(compactResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-5",
          instructions: { text: "preserve tool state" },
          previous_response_id: "resp_prev",
        }),
      );
      expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.42);
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/compact",
          provider: "openai",
          model: "openai:gpt-5",
          estimatedCost: 0.42,
          statusCode: 200,
        }),
      );
    });

    it("falls through to Azure when the primary provider returns 404", async () => {
      const primaryCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "not found"));
      const azureCompact = vi.fn().mockResolvedValueOnce({
        id: "resp_002",
        object: "response.compaction",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });

      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "azure-cognitive-services"
          ? makeProvider("azure-cognitive-services", azureCompact)
          : null,
      );

      const result = await handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1");

      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureCompact).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5" }));
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/compact",
          provider: "azure-cognitive-services",
          statusCode: 200,
        }),
      );
    });

    it("throws ResponseNotFoundError when both providers return 404", async () => {
      const primaryCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      const azureCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));

      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "azure-cognitive-services"
          ? makeProvider("azure-cognitive-services", azureCompact)
          : null,
      );

      await expect(
        handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(ResponseNotFoundError);
    });

    it("does not retry Azure on a non-404 upstream error", async () => {
      const primaryCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureCompact = vi.fn();

      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "azure-cognitive-services"
          ? makeProvider("azure-cognitive-services", azureCompact)
          : null,
      );

      await expect(
        handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(UpstreamResponsesApiError);
      expect(azureCompact).not.toHaveBeenCalled();
    });

    it("throws ApiKeyUnbillableResponseUsageError when required and pricing is missing", async () => {
      mockGetModelPricing.mockReturnValueOnce(undefined);
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel(
          "openai",
          "gpt-5",
          vi.fn(),
          vi.fn(),
          vi.fn().mockResolvedValueOnce({
            id: "resp_001",
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }),
        ),
      });

      await expect(
        handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1", {
          requireBillableUsage: true,
        }),
      ).rejects.toBeInstanceOf(ApiKeyUnbillableResponseUsageError);
    });

    it("rejects a model that does not resolve", async () => {
      mockResolveResponseTarget.mockResolvedValueOnce(null);
      mockResolveChatModel.mockResolvedValueOnce(null);

      await expect(handleResponseCompact({ model: "openai:gpt-5" }, "key-1")).rejects.toThrow(
        "No provider found",
      );
    });

    it("rejects a non-Responses-capable model with UnsupportedResponseFeatureError", async () => {
      mockResolveResponseTarget.mockResolvedValueOnce(null);
      mockResolveChatModel.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "anthropic:claude",
        targets: [createResolvedModel("anthropic", "claude")],
      });

      await expect(
        handleResponseCompact({ model: "anthropic:claude" }, "key-1"),
      ).rejects.toBeInstanceOf(UnsupportedResponseFeatureError);
    });

    it("logs and rethrows upstream non-404 errors", async () => {
      const primaryCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(400, "bad request"));
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
      });
      mockGetProviderByName.mockReturnValue(null);

      await expect(
        handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(UpstreamResponsesApiError);
    });
  });

  describe("handleResponseInputItems", () => {
    function makeProvider(name: string, listResponseInputItems: ReturnType<typeof vi.fn>) {
      return {
        name,
        chatCompletion: vi.fn(),
        chatCompletionStream: vi.fn(),
        listResponseInputItems,
        listModels: vi.fn().mockReturnValue([]),
        capabilities: openAICompatibleCapabilities,
      };
    }

    it("returns the OpenAI list response and logs a 200 entry", async () => {
      const listResponseInputItems = vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [{ id: "msg_abc", type: "message", role: "user" }],
        first_id: "msg_abc",
        last_id: "msg_abc",
        has_more: false,
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", listResponseInputItems) : null,
      );

      const result = await handleResponseInputItems("resp_abc", "key-1", {
        include: ["file_search_call.results"],
        limit: "10",
      });

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai",
        response: { object: "list", has_more: false },
      });
      expect(listResponseInputItems).toHaveBeenCalledWith("resp_abc", {
        include: ["file_search_call.results"],
        limit: "10",
      });
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/input_items",
          provider: "openai",
          statusCode: 200,
        }),
      );
    });

    it("falls through to Azure when OpenAI returns 404", async () => {
      const openaiList = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "not found"));
      const azureList = vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [],
        first_id: "",
        last_id: "",
        has_more: false,
      });
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiList);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureList);
        return null;
      });

      const result = await handleResponseInputItems("resp_abc", "key-1");
      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureList).toHaveBeenCalledWith("resp_abc", undefined);
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/input_items",
          provider: "azure-cognitive-services",
          statusCode: 200,
        }),
      );
    });

    it("throws ResponseNotFoundError when both providers return 404", async () => {
      const openaiList = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      const azureList = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiList);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureList);
        return null;
      });

      await expect(handleResponseInputItems("resp_x", "key-1")).rejects.toBeInstanceOf(
        ResponseNotFoundError,
      );
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/:id/input_items",
          statusCode: 404,
        }),
      );
    });

    it("does not retry Azure on a non-404 upstream error", async () => {
      const openaiList = vi.fn().mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureList = vi.fn();
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiList);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureList);
        return null;
      });

      await expect(handleResponseInputItems("resp_x", "key-1")).rejects.toBeInstanceOf(
        UpstreamResponsesApiError,
      );
      expect(azureList).not.toHaveBeenCalled();
    });

    it("throws OpenAIResponseProviderNotConfiguredError when no adapter implements the method", async () => {
      mockGetProviderByName.mockReturnValue(null);

      await expect(handleResponseInputItems("resp_x", "key-1")).rejects.toBeInstanceOf(
        OpenAIResponseProviderNotConfiguredError,
      );
    });

    it("skips providers that do not implement listResponseInputItems", async () => {
      const azureList = vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [],
        first_id: "",
        last_id: "",
        has_more: false,
      });
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") {
          return {
            name: "openai",
            chatCompletion: vi.fn(),
            chatCompletionStream: vi.fn(),
            listModels: vi.fn().mockReturnValue([]),
            capabilities: openAICompatibleCapabilities,
          };
        }
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureList);
        return null;
      });

      const result = await handleResponseInputItems("resp_abc", "key-1");
      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureList).toHaveBeenCalledWith("resp_abc", undefined);
    });
  });

  describe("handleResponseInputTokens", () => {
    function makeProvider(name: string, countResponseInputTokens: ReturnType<typeof vi.fn>) {
      return {
        name,
        chatCompletion: vi.fn(),
        chatCompletionStream: vi.fn(),
        countResponseInputTokens,
        listModels: vi.fn().mockReturnValue([]),
        capabilities: openAICompatibleCapabilities,
      };
    }

    it("applies channel body and header overrides for resolved input-token targets", async () => {
      const countResponseInputTokens = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 42,
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-4o",
        target: {
          provider: makeProvider("openai", countResponseInputTokens),
          providerName: "openai",
          modelId: "gpt-4o",
          publicModelId: "openai:gpt-4o",
          apiKey: "sk-upstream",
          headerOverride: {
            "X-Key": "{api_key}",
            "X-Trace": "{client_header:X-Trace}",
          },
          paramOverride: { metadata: { channel: "primary" } },
        },
      });

      const result = await handleResponseInputTokens(
        { model: "openai:gpt-4o", input: "hi" },
        "key-1",
        { requestContext: { clientHeaders: new Headers({ "X-Trace": "trace-123" }) } },
      );

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai:gpt-4o",
        response: { object: "response.input_tokens", input_tokens: 42 },
      });
      expect(countResponseInputTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o",
          input: "hi",
          metadata: { channel: "primary" },
        }),
        {
          headers: {
            "x-key": "sk-upstream",
            "x-trace": "trace-123",
          },
        },
      );
      expect(mockGetProviderByName).not.toHaveBeenCalled();
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/input_tokens",
          provider: "openai",
          model: "openai:gpt-4o",
          statusCode: 200,
        }),
      );
    });

    it("passes raw body for pass-through resolved input-token targets", async () => {
      const countResponseInputTokens = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 42,
      });
      const rawBody = '{\n  "model": "openai:gpt-4o",\n  "input": "hi"\n}';
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-4o",
        target: {
          provider: makeProvider("openai", countResponseInputTokens),
          providerName: "openai",
          modelId: "gpt-4o",
          publicModelId: "openai:gpt-4o",
          settings: { passThroughBodyEnabled: true },
          paramOverride: { metadata: { channel: "primary" } },
        },
      });

      await handleResponseInputTokens({ model: "openai:gpt-4o", input: "hi" }, "key-1", {
        rawBody,
      });

      expect(countResponseInputTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o",
          input: "hi",
        }),
        { headers: {}, rawBody },
      );
    });

    it("returns the OpenAI input-token count and logs a 200 entry without billing", async () => {
      const countResponseInputTokens = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 42,
      });
      mockGetProviderByName.mockImplementation((name: string) =>
        name === "openai" ? makeProvider("openai", countResponseInputTokens) : null,
      );

      const result = await handleResponseInputTokens(
        { model: "openai:gpt-4o", input: "hi" },
        "key-1",
      );

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai:gpt-4o",
        response: { object: "response.input_tokens", input_tokens: 42 },
      });
      expect(countResponseInputTokens).toHaveBeenCalledWith({
        model: "openai:gpt-4o",
        input: "hi",
      });
      expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/input_tokens",
          provider: "openai",
          model: "openai:gpt-4o",
          statusCode: 200,
        }),
      );
    });

    it("falls through to Azure when OpenAI returns 404", async () => {
      const openaiCount = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "not found"));
      const azureCount = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 9,
      });
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCount);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCount);
        return null;
      });

      const result = await handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1");

      expect(result).toMatchObject({
        provider: "azure-cognitive-services",
        response: { object: "response.input_tokens", input_tokens: 9 },
      });
      expect(azureCount).toHaveBeenCalledWith({ model: "gpt-4o", input: "hi" });
      expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
    });

    it("throws ResponseNotFoundError when both providers return 404", async () => {
      const openaiCount = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      const azureCount = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCount);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCount);
        return null;
      });

      await expect(
        handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(ResponseNotFoundError);
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/v1/responses/input_tokens",
          statusCode: 404,
        }),
      );
    });

    it("does not retry Azure on a non-404 upstream error", async () => {
      const openaiCount = vi.fn().mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureCount = vi.fn();
      mockGetProviderByName.mockImplementation((name: string) => {
        if (name === "openai") return makeProvider("openai", openaiCount);
        if (name === "azure-cognitive-services")
          return makeProvider("azure-cognitive-services", azureCount);
        return null;
      });

      await expect(
        handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(UpstreamResponsesApiError);
      expect(azureCount).not.toHaveBeenCalled();
    });

    it("throws OpenAIResponseProviderNotConfiguredError when no adapter implements the method", async () => {
      mockGetProviderByName.mockReturnValue(null);

      await expect(
        handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(OpenAIResponseProviderNotConfiguredError);
    });
  });
});
