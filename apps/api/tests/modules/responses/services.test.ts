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
  mockListConfiguredProviders,
  mockIsResponsesCacheEnabled,
  mockLogRequest,
  mockPrismaBackgroundResponseJobCreate,
  mockPrismaBackgroundResponseJobDelete,
  mockPrismaBackgroundResponseJobFindUnique,
  mockPrismaBackgroundResponseJobUpdate,
  mockReadCachedResponse,
  mockResolveChatModel,
  mockResolveResponseTarget,
  mockResolveResponseTargets,
  mockRefundSpendReservation,
  mockReserveSpend,
  mockSettleSpendReservation,
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
  mockListConfiguredProviders: vi.fn(),
  mockIsResponsesCacheEnabled: vi.fn(),
  mockLogRequest: vi.fn(),
  mockPrismaBackgroundResponseJobCreate: vi.fn(),
  mockPrismaBackgroundResponseJobDelete: vi.fn(),
  mockPrismaBackgroundResponseJobFindUnique: vi.fn(),
  mockPrismaBackgroundResponseJobUpdate: vi.fn(),
  mockReadCachedResponse: vi.fn(),
  mockResolveChatModel: vi.fn(),
  mockResolveResponseTarget: vi.fn(),
  mockResolveResponseTargets: vi.fn(),
  mockRefundSpendReservation: vi.fn(),
  mockReserveSpend: vi.fn(),
  mockSettleSpendReservation: vi.fn(),
  mockWriteCachedResponse: vi.fn(),
  mockGetResponsesCacheTtlSeconds: vi.fn(),
}));

vi.mock("@repo/worker", () => ({
  backoffMs: mockBackoffMs,
  enqueueBackgroundPoll: mockEnqueueBackgroundPoll,
}));

vi.mock("../../../src/modules/relay/billing", () => ({
  expandSpendReservation: vi.fn(),
  refundSpendReservation: mockRefundSpendReservation,
  reserveSpend: mockReserveSpend,
  settleSpendReservation: mockSettleSpendReservation,
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
  getProviderChannelRuntime: mockGetProviderChannelRuntime,
  getProviderForChannel: mockGetProviderForChannel,
  getProviderByName: mockGetProviderByName,
  listConfiguredProviders: mockListConfiguredProviders,
  resolveChatModel: mockResolveChatModel,
  resolveResponseTarget: mockResolveResponseTarget,
  resolveResponseTargets: mockResolveResponseTargets,
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

function expectedRelayOptions(extra: Record<string, unknown> = {}) {
  return expect.objectContaining({
    headers: {},
    signal: expect.any(Object),
    onResponse: expect.any(Function),
    ...extra,
  });
}

describe("responses services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderByName.mockReset();
    mockListConfiguredProviders.mockReturnValue([]);
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
    mockRefundSpendReservation.mockResolvedValue(undefined);
    mockReserveSpend.mockResolvedValue(null);
    mockSettleSpendReservation.mockResolvedValue(undefined);
    mockResolveResponseTargets.mockImplementation(async (model: string) => {
      const resolved = await mockResolveResponseTarget(model);
      return resolved
        ? {
            kind: resolved.kind,
            requestedModelId: resolved.requestedModelId,
            targets: [resolved.target],
          }
        : null;
    });
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
      createResponse: async (...args: unknown[]) => {
        const value = await createResponse(...args);
        if (!value || typeof value !== "object") return value;
        return {
          output: [],
          ...(Object.hasOwn(value, "object") ? {} : { object: "response", status: "completed" }),
          ...value,
        };
      },
      createResponseStream,
      getResponse: vi.fn(),
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
      capabilities: { ...openAICompatibleCapabilities, responsesTransport: "native" as const },
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

    expect(result.response).toMatchObject({ id: "resp-1", model: "openai:gpt-4o" });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        input: "hello",
        text: { format: { type: "text" } },
      }),
      expectedRelayOptions(),
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

  it("bridges eligible Responses requests through chat completion", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "hello from chat" },
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
    const nativeTarget = createResolvedModel("custom", "gpt-4o");
    const target = {
      ...nativeTarget,
      provider: {
        ...nativeTarget.provider,
        chatCompletion,
        createResponse: undefined,
        capabilities: {
          ...nativeTarget.provider.capabilities,
          responsesTransport: "chat" as const,
        },
      },
    };
    mockResolveResponseTargets.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "custom:gpt-4o",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleResponseCreate(
      createRequest({ model: "custom:gpt-4o", instructions: "Be concise" }),
      "key-1",
    );

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "hello" },
        ],
      }),
      expectedRelayOptions(),
    );
    expect(result.response).toMatchObject({
      object: "response",
      status: "completed",
      model: "custom:gpt-4o",
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello from chat" }],
        },
      ],
    });
  });

  it("retries another Responses target after a retryable create failure", async () => {
    const primaryCreate = vi.fn().mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
    const fallbackCreate = vi.fn().mockResolvedValueOnce({
      id: "resp-fallback",
      model: "gpt-4o",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    mockResolveResponseTargets.mockResolvedValueOnce({
      kind: "fallback-group",
      requestedModelId: "mux:fast",
      targets: [
        createResolvedModel("openai", "gpt-4o", primaryCreate),
        createResolvedModel("azure-cognitive-services", "gpt-4o", fallbackCreate),
      ],
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleResponseCreate(createRequest({ model: "mux:fast" }), "key-1", {
      config: {
        retryCount: 1,
        retryStatusCodes: [{ start: 500, end: 500 }],
        nonStreamTimeoutMs: 1_000,
        firstByteTimeoutMs: 1_000,
        streamIdleTimeoutMs: 1_000,
        maxRequestBodyBytes: 1_000,
        rateLimitWindowSeconds: 60,
        rateLimitTotal: 0,
        rateLimitSuccess: 0,
      },
    });

    expect(primaryCreate).toHaveBeenCalledOnce();
    expect(fallbackCreate).toHaveBeenCalledOnce();
    expect(result.response).toMatchObject({ id: "resp-fallback", model: "mux:fast" });
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
      expectedRelayOptions({
        headers: {
          "x-key": "sk-upstream",
          "x-trace": "trace-123",
        },
      }),
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
      expectedRelayOptions({ rawBody }),
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
      expectedRelayOptions(),
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
      expectedRelayOptions(),
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
      expectedRelayOptions(),
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
      expectedRelayOptions(),
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
          output: [],
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

    it("persists reservation metadata and queues repair when terminal settlement fails", async () => {
      const createResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_billing_repair",
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
      const pricing = {
        id: "gpt-5",
        inputPricePer1M: 1.25,
        outputPricePer1M: 10,
        maxOutputTokens: 4_096,
      };
      mockGetModelPricing
        .mockReturnValueOnce(pricing)
        .mockReturnValueOnce(pricing)
        .mockReturnValueOnce(pricing);
      mockEstimateCost.mockReturnValueOnce(0.5).mockReturnValueOnce(0.000325);
      mockReserveSpend.mockResolvedValueOnce({
        requestId: "request-1",
        reservedUsd: 0.5,
        limits: { apiKeyId: "key-1", ownerId: "user-1", apiKeyLimitUsd: 10 },
      });
      mockSettleSpendReservation.mockRejectedValueOnce(new Error("redis offline"));
      mockPrismaBackgroundResponseJobCreate.mockResolvedValueOnce({
        id: "resp_bg_billing_repair",
      });

      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1", {
          requireBillableUsage: true,
          billing: { apiKeyId: "key-1", ownerId: "user-1", apiKeyLimitUsd: 10 },
          requestId: "request-1",
        }),
      ).rejects.toThrow("redis offline");

      expect(mockPrismaBackgroundResponseJobCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            spendReservationId: "request-1",
            spendReservedUsd: 0.5,
            spendOwnerId: "user-1",
          }),
        }),
      );
      expect(mockEnqueueBackgroundPoll).toHaveBeenCalledWith("resp_bg_billing_repair", 1, 2_000);
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

    it("marks a persisted job failed when background polling cannot be enqueued", async () => {
      const createResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_bg_unqueued",
        object: "response",
        status: "queued",
        model: "gpt-5",
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", createResponse),
      });
      mockPrismaBackgroundResponseJobCreate.mockResolvedValueOnce({ id: "resp_bg_unqueued" });
      mockPrismaBackgroundResponseJobUpdate.mockResolvedValueOnce({});
      mockEnqueueBackgroundPoll.mockRejectedValueOnce(new Error("queue unavailable"));

      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1"),
      ).rejects.toThrow("queue unavailable");

      expect(mockPrismaBackgroundResponseJobUpdate).toHaveBeenCalledWith({
        where: { id: "resp_bg_unqueued" },
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("queue unavailable"),
          completedAt: expect.any(Date),
          spendReservationId: null,
          spendReservedUsd: null,
          spendOwnerId: null,
        }),
      });
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

    it("rejects a malformed background response without status", async () => {
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
      await expect(
        submitBackgroundResponse(createRequest({ background: true }), "key-1"),
      ).rejects.toThrow("malformed Response object");
      expect(mockPrismaBackgroundResponseJobCreate).not.toHaveBeenCalled();
      expect(mockEnqueueBackgroundPoll).not.toHaveBeenCalled();
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

    expect(result.response).toMatchObject({
      id: "resp-1",
      model: "azure-cognitive-services:gpt-5",
    });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5" }),
      expectedRelayOptions(),
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

    const result = await handleResponseCreate(createRequest({ model: "mux:fast" }), "key-1");

    expect(result.response).toMatchObject({ id: "resp-1", model: "mux:fast" });
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

    expect(result.response).toMatchObject({ id: "resp-1", model: "fast-chat" });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
      expectedRelayOptions(),
    );
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

  it("includes configured custom native providers in response utility routing", async () => {
    const getResponse = vi.fn().mockResolvedValueOnce({
      id: "resp_custom",
      object: "response",
      status: "completed",
      model: "custom-model",
    });
    mockListConfiguredProviders.mockReturnValueOnce(["custom-native"]);
    mockGetProviderByName.mockImplementation((name: string) =>
      name === "custom-native"
        ? {
            name,
            capabilities: {
              ...openAICompatibleCapabilities,
              responsesTransport: "native" as const,
            },
            getResponse,
            listModels: vi.fn().mockReturnValue([]),
          }
        : null,
    );

    const result = await handleResponseRetrieve("resp_custom", "key-1");

    expect(result).toMatchObject({ id: "resp_custom" });
    expect(getResponse).toHaveBeenCalledWith("resp_custom", undefined);
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

  it("maps upstream not-found responses to ResponseNotFoundError", async () => {
    const getResponse = vi
      .fn()
      .mockRejectedValueOnce(new Error("OpenAI Responses API error: 404 - not found"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseRetrieve("resp_abc", "key-1")).rejects.toBeInstanceOf(
      ResponseNotFoundError,
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 404,
        errorMessage: expect.stringContaining("404"),
      }),
    );
  });

  it("does not retain upstream response bodies in retrieval failure logs", async () => {
    const getResponse = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "private upstream details"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      getResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseRetrieve("resp_abc", "key-1")).rejects.toBeInstanceOf(
      UpstreamResponsesApiError,
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        errorMessage: "OpenAI upstream error (status 500)",
      }),
    );
    expect(JSON.stringify(mockLogRequest.mock.calls)).not.toContain("private upstream details");
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

  it("does not expose a local background response owned by another API key", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_private",
      apiKeyId: "key-2",
      provider: "openai",
      model: "openai:gpt-5",
      status: "completed",
      response: { id: "resp_bg_private", status: "completed" },
    });

    await expect(handleResponseRetrieve("resp_bg_private", "key-1")).rejects.toBeInstanceOf(
      ResponseNotFoundError,
    );
    expect(mockGetProviderByName).not.toHaveBeenCalled();
    expect(mockLogRequest).not.toHaveBeenCalled();
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
      spendReservationId: "req-delete",
      spendReservedUsd: 0.25,
      spendOwnerId: "user-1",
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
    expect(mockRefundSpendReservation).toHaveBeenCalledWith({
      requestId: "req-delete",
      reservedUsd: 0.25,
      limits: { apiKeyId: "key-1", ownerId: "user-1" },
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

  it("settles a completed local job from stored usage before deleting it", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
      id: "resp_bg_done",
      apiKeyId: "key-1",
      provider: "openai",
      model: "openai:gpt-5",
      status: "completed",
      response: {
        id: "resp_bg_done",
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
      spendReservationId: "req-delete-done",
      spendReservedUsd: 0.25,
      spendOwnerId: "user-1",
    });
    mockGetProviderByName.mockReturnValue(null);
    mockEstimateCost.mockReturnValueOnce(0.01);
    mockPrismaBackgroundResponseJobDelete.mockResolvedValueOnce({});

    await handleResponseDelete("resp_bg_done", "key-1");

    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-5", 10, 5, undefined);
    expect(mockSettleSpendReservation).toHaveBeenCalledWith(
      {
        requestId: "req-delete-done",
        reservedUsd: 0.25,
        limits: { apiKeyId: "key-1", ownerId: "user-1" },
      },
      0.01,
    );
    expect(mockPrismaBackgroundResponseJobDelete).toHaveBeenCalledWith({
      where: { id: "resp_bg_done" },
    });
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

  it("maps upstream delete not-found responses to ResponseNotFoundError", async () => {
    mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce(null);
    const deleteResponse = vi
      .fn()
      .mockRejectedValueOnce(new Error("OpenAI Responses API error: 404 - not found"));
    mockGetProviderByName.mockReturnValueOnce({
      name: "openai",
      deleteResponse,
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleResponseDelete("resp_abc", "key-1")).rejects.toBeInstanceOf(
      ResponseNotFoundError,
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/responses/:id",
        statusCode: 404,
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
        capabilities: { ...openAICompatibleCapabilities, responsesTransport: "native" as const },
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
        spendReservationId: "req-cancel",
        spendReservedUsd: 0.5,
        spendOwnerId: "user-1",
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
      expect(mockRefundSpendReservation).toHaveBeenCalledWith({
        requestId: "req-cancel",
        reservedUsd: 0.5,
        limits: { apiKeyId: "key-1", ownerId: "user-1" },
      });
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
    it("compacts via the resolved provider, rewrites the model id, and logs spend", async () => {
      const compactResponse = vi.fn().mockResolvedValueOnce({
        id: "resp_001",
        object: "response.compaction",
        model: "gpt-5",
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
      mockResolveResponseTarget.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        target: createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), compactResponse),
      });
      mockGetModelPricing.mockReturnValue({ id: "gpt-5" });
      mockEstimateCost.mockReturnValue(0.42);

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
        response: { model: "openai:gpt-5" },
      });
      expect(compactResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-5",
          instructions: { text: "preserve tool state" },
          previous_response_id: "resp_prev",
        }),
        expectedRelayOptions(),
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

      const primaryTarget = createResolvedModel(
        "openai",
        "gpt-5",
        vi.fn(),
        vi.fn(),
        primaryCompact,
      );
      const azureTarget = createResolvedModel(
        "azure-cognitive-services",
        "gpt-5",
        vi.fn(),
        vi.fn(),
        azureCompact,
      );
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        targets: [primaryTarget, azureTarget],
      });

      const result = await handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1");

      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureCompact).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-5" }),
        expectedRelayOptions(),
      );
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

      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        targets: [
          createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
          createResolvedModel("azure-cognitive-services", "gpt-5", vi.fn(), vi.fn(), azureCompact),
        ],
      });

      await expect(
        handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(ResponseNotFoundError);
    });

    it("retries another routed target on a retryable upstream error", async () => {
      const primaryCompact = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureCompact = vi.fn().mockResolvedValueOnce({
        id: "resp_retried",
        object: "response.compaction",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });

      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-5",
        targets: [
          createResolvedModel("openai", "gpt-5", vi.fn(), vi.fn(), primaryCompact),
          createResolvedModel("azure-cognitive-services", "gpt-5", vi.fn(), vi.fn(), azureCompact),
        ],
      });

      const result = await handleResponseCompact({ model: "openai:gpt-5", input: "hi" }, "key-1");
      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureCompact).toHaveBeenCalledOnce();
    });

    it("throws ApiKeyUnbillableResponseUsageError when required and pricing is missing", async () => {
      mockGetModelPricing.mockReturnValue(undefined);
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
        capabilities: { ...openAICompatibleCapabilities, responsesTransport: "native" as const },
      };
    }

    it("routes input items through the provider stored for a background response", async () => {
      const listResponseInputItems = vi.fn().mockResolvedValueOnce({
        object: "list",
        data: [],
        has_more: false,
      });
      mockPrismaBackgroundResponseJobFindUnique.mockResolvedValueOnce({
        id: "resp_custom",
        apiKeyId: "key-1",
        provider: "custom-provider",
        model: "custom-provider:model",
        request: { model: "custom-alias" },
        status: "completed",
        response: {},
        channelId: "custom-channel",
        channelName: "Custom primary",
      });
      mockGetProviderForChannel.mockReturnValueOnce(
        makeProvider("custom-provider", listResponseInputItems),
      );

      const result = await handleResponseInputItems("resp_custom", "key-1", { limit: "5" });

      expect(mockGetProviderForChannel).toHaveBeenCalledWith("custom-provider", "custom-channel");
      expect(listResponseInputItems).toHaveBeenCalledWith("resp_custom", { limit: "5" });
      expect(result).toMatchObject({
        provider: "custom-provider",
        model: "custom-provider:model",
        response: { object: "list" },
      });
      expect(mockLogRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "custom-provider",
          requestedModel: "custom-alias",
          endpoint: "/v1/responses/:id/input_items",
          statusCode: 200,
        }),
      );
    });

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
            capabilities: {
              ...openAICompatibleCapabilities,
              responsesTransport: "native" as const,
            },
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
        capabilities: { ...openAICompatibleCapabilities, responsesTransport: "native" as const },
      };
    }

    function tokenTarget(name: string, countResponseInputTokens: ReturnType<typeof vi.fn>) {
      return {
        provider: makeProvider(name, countResponseInputTokens),
        providerName: name,
        modelId: "gpt-4o",
        publicModelId: `${name}:gpt-4o`,
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
        expectedRelayOptions({
          headers: {
            "x-key": "sk-upstream",
            "x-trace": "trace-123",
          },
        }),
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
        expectedRelayOptions({ rawBody }),
      );
    });

    it("returns the OpenAI input-token count and logs a 200 entry without billing", async () => {
      const countResponseInputTokens = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 42,
      });
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-4o",
        targets: [tokenTarget("openai", countResponseInputTokens)],
      });

      const result = await handleResponseInputTokens(
        { model: "openai:gpt-4o", input: "hi" },
        "key-1",
      );

      expect(result).toMatchObject({
        provider: "openai",
        model: "openai:gpt-4o",
        response: { object: "response.input_tokens", input_tokens: 42 },
      });
      expect(countResponseInputTokens).toHaveBeenCalledWith(
        { model: "gpt-4o", input: "hi" },
        expectedRelayOptions(),
      );
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
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "fallback-group",
        requestedModelId: "gpt-4o",
        targets: [
          tokenTarget("openai", openaiCount),
          tokenTarget("azure-cognitive-services", azureCount),
        ],
      });

      const result = await handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1");

      expect(result).toMatchObject({
        provider: "azure-cognitive-services",
        response: { object: "response.input_tokens", input_tokens: 9 },
      });
      expect(azureCount).toHaveBeenCalledWith(
        { model: "gpt-4o", input: "hi" },
        expectedRelayOptions(),
      );
      expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
    });

    it("throws ResponseNotFoundError when both providers return 404", async () => {
      const openaiCount = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      const azureCount = vi
        .fn()
        .mockRejectedValueOnce(new UpstreamResponsesApiError(404, "missing"));
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "fallback-group",
        requestedModelId: "gpt-4o",
        targets: [
          tokenTarget("openai", openaiCount),
          tokenTarget("azure-cognitive-services", azureCount),
        ],
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

    it("retries another routed target on a retryable upstream error", async () => {
      const openaiCount = vi.fn().mockRejectedValueOnce(new UpstreamResponsesApiError(500, "boom"));
      const azureCount = vi.fn().mockResolvedValueOnce({
        object: "response.input_tokens",
        input_tokens: 9,
      });
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "fallback-group",
        requestedModelId: "gpt-4o",
        targets: [
          tokenTarget("openai", openaiCount),
          tokenTarget("azure-cognitive-services", azureCount),
        ],
      });

      const result = await handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1");
      expect(result.provider).toBe("azure-cognitive-services");
      expect(azureCount).toHaveBeenCalledOnce();
    });

    it("throws UnsupportedResponseFeatureError when no routed adapter implements the method", async () => {
      mockResolveResponseTargets.mockResolvedValueOnce({
        kind: "direct",
        requestedModelId: "openai:gpt-4o",
        targets: [
          {
            ...tokenTarget("openai", vi.fn()),
            provider: {
              ...makeProvider("openai", vi.fn()),
              countResponseInputTokens: undefined,
            },
          },
        ],
      });

      await expect(
        handleResponseInputTokens({ model: "gpt-4o", input: "hi" }, "key-1"),
      ).rejects.toBeInstanceOf(UnsupportedResponseFeatureError);
    });
  });
});
