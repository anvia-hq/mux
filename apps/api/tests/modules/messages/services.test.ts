import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockLogRequest,
  mockResolveAnthropicMessageTokenCountModel,
  mockResolveAnthropicMessagesModel,
  mockReserveSpend,
  mockExpandSpendReservation,
  mockRefundSpendReservation,
  mockSettleSpendReservation,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveAnthropicMessageTokenCountModel: vi.fn(),
  mockResolveAnthropicMessagesModel: vi.fn(),
  mockReserveSpend: vi.fn(),
  mockExpandSpendReservation: vi.fn(),
  mockRefundSpendReservation: vi.fn(),
  mockSettleSpendReservation: vi.fn(),
}));

vi.mock("../../../src/modules/relay/billing", () => ({
  reserveSpend: mockReserveSpend,
  expandSpendReservation: mockExpandSpendReservation,
  refundSpendReservation: mockRefundSpendReservation,
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
  resolveAnthropicMessageTokenCountModel: mockResolveAnthropicMessageTokenCountModel,
  resolveAnthropicMessagesModel: mockResolveAnthropicMessagesModel,
}));

import {
  ApiKeyUnbillableAnthropicMessageUsageError,
  handleAnthropicMessage,
  handleAnthropicMessageTokenCount,
} from "../../../src/modules/messages/services";
import { MessagesRelayTimeoutError } from "../../../src/modules/messages/relay/errors";
import { UpstreamAnthropicMessagesApiError } from "../../../src/providers/anthropic";

describe("messages services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const relayConfig = {
    retryCount: 1,
    retryStatusCodes: [
      { start: 408, end: 408 },
      { start: 429, end: 429 },
      { start: 500, end: 599 },
    ],
    firstByteTimeoutMs: 25,
    streamIdleTimeoutMs: 25,
    nonStreamTimeoutMs: 25,
    maxRequestBodyBytes: 1024,
    rateLimitWindowSeconds: 60,
    rateLimitTotal: 0,
    rateLimitSuccess: 0,
  };

  function resolvedTarget(overrides?: {
    createAnthropicMessage?: ReturnType<typeof vi.fn>;
    createAnthropicMessageStream?: ReturnType<typeof vi.fn>;
    countAnthropicMessageTokens?: ReturnType<typeof vi.fn>;
    upstreamModelId?: string;
    paramOverride?: Record<string, unknown>;
    headerOverride?: Record<string, unknown>;
    settings?: { passThroughBodyEnabled?: boolean };
  }) {
    return {
      provider: {
        name: "anthropic",
        createAnthropicMessage: overrides?.createAnthropicMessage ?? vi.fn(),
        createAnthropicMessageStream: overrides?.createAnthropicMessageStream ?? vi.fn(),
        countAnthropicMessageTokens: overrides?.countAnthropicMessageTokens ?? vi.fn(),
      },
      providerName: "anthropic",
      channelId: "anthropic",
      channelName: "Anthropic",
      modelId: "claude-test",
      upstreamModelId: overrides?.upstreamModelId ?? "claude-test",
      publicModelId: "anthropic:claude-test",
      apiKey: "sk-channel",
      paramOverride: overrides?.paramOverride,
      headerOverride: overrides?.headerOverride,
      settings: overrides?.settings,
    };
  }

  it("calls native provider, logs usage, and records spend for limited requests", async () => {
    const createAnthropicMessage = vi.fn().mockResolvedValueOnce({
      id: "msg-1",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      },
    });
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [resolvedTarget({ createAnthropicMessage })],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "claude-test" });
    mockEstimateCost.mockReturnValueOnce(0.05);

    const result = await handleAnthropicMessage(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      },
      "key-1",
      {
        requireBillableUsage: true,
        providerOptions: { headers: { "anthropic-version": "2023-06-01" } },
      },
    );

    expect(result).toMatchObject({ kind: "complete", response: { id: "msg-1" } });
    expect(createAnthropicMessage).toHaveBeenCalledWith(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 4096,
        stream: false,
      },
      expect.objectContaining({
        headers: { "anthropic-version": "2023-06-01" },
        signal: expect.any(AbortSignal),
        onResponse: expect.any(Function),
      }),
    );
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.05);
    expect(mockEstimateCost).toHaveBeenCalledWith("anthropic:claude-test", 80, 20, undefined, 80);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/messages",
        model: "anthropic:claude-test",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        pricingInputTokens: 80,
        estimatedCost: 0.05,
        statusCode: 200,
      }),
    );
  });

  it("throws when limited usage cannot be billed", async () => {
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({
          createAnthropicMessage: vi.fn().mockResolvedValueOnce({
            id: "msg-1",
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
        }),
      ],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "claude-test" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleAnthropicMessage(
        { model: "claude-test", messages: [{ role: "user", content: "hi" }] },
        "key-1",
        { requireBillableUsage: true },
      ),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableAnthropicMessageUsageError);
  });

  it("returns native streams from the selected provider", async () => {
    async function* stream() {
      yield 'data: {"type":"message_start"}\n\n';
    }

    const createAnthropicMessageStream = vi.fn().mockReturnValue(stream());
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [resolvedTarget({ createAnthropicMessageStream })],
    });

    const result = await handleAnthropicMessage(
      { model: "claude-test", messages: [{ role: "user", content: "hi" }], stream: true },
      "key-1",
    );

    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") return;

    const chunks = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['data: {"type":"message_start"}\n\n']);
    expect(createAnthropicMessageStream).toHaveBeenCalledWith(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 4096,
        stream: true,
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onResponse: expect.any(Function),
      }),
    );
  });

  it("applies channel model mapping, param overrides, and header overrides", async () => {
    const createAnthropicMessage = vi.fn().mockResolvedValueOnce({
      id: "msg-1",
      model: "claude-upstream",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({
          createAnthropicMessage,
          upstreamModelId: "claude-upstream",
          paramOverride: { max_tokens: 7 },
          headerOverride: { "anthropic-version": "2024-01-01" },
        }),
      ],
    });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await handleAnthropicMessage(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 99,
      },
      "key-1",
      {
        providerOptions: {
          headers: {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
          },
        },
        requestContext: { originalModel: "claude-test" },
      },
    );

    expect(createAnthropicMessage).toHaveBeenCalledWith(
      {
        model: "claude-upstream",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 7,
        stream: false,
      },
      {
        headers: {
          "anthropic-version": "2024-01-01",
          "anthropic-beta": "tools-2024-04-04",
        },
        signal: expect.any(AbortSignal),
        onResponse: expect.any(Function),
      },
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        channelId: "anthropic",
        channelName: "Anthropic",
        model: "anthropic:claude-test",
        statusCode: 200,
      }),
    );
  });

  it("counts tokens through the native Anthropic endpoint with channel settings", async () => {
    const countAnthropicMessageTokens = vi.fn().mockResolvedValueOnce({ input_tokens: 42 });
    mockResolveAnthropicMessageTokenCountModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({
          countAnthropicMessageTokens,
          upstreamModelId: "claude-upstream",
          paramOverride: { system: "count this" },
          headerOverride: { "anthropic-version": "2024-01-01" },
        }),
      ],
    });

    const result = await handleAnthropicMessageTokenCount(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 99,
        stream: true,
      },
      "key-1",
      {
        providerOptions: {
          headers: {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
          },
        },
      },
    );

    expect(result).toMatchObject({
      provider: "anthropic",
      model: "anthropic:claude-test",
      response: { input_tokens: 42 },
    });
    expect(countAnthropicMessageTokens).toHaveBeenCalledWith(
      {
        model: "claude-upstream",
        messages: [{ role: "user", content: "hi" }],
        system: "count this",
      },
      {
        headers: {
          "anthropic-version": "2024-01-01",
          "anthropic-beta": "tools-2024-04-04",
        },
        signal: expect.any(AbortSignal),
        onResponse: expect.any(Function),
      },
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/messages/count_tokens",
        promptTokens: 42,
        totalTokens: 42,
        statusCode: 200,
      }),
    );
  });

  it("does not retry a non-retryable upstream validation error", async () => {
    const primary = vi
      .fn()
      .mockRejectedValueOnce(
        new UpstreamAnthropicMessagesApiError(
          400,
          '{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}',
          "application/json",
        ),
      );
    const backup = vi.fn();
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "fallback-group",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({ createAnthropicMessage: primary }),
        resolvedTarget({ createAnthropicMessage: backup }),
      ],
    });

    await expect(
      handleAnthropicMessage(
        { model: "claude-test", messages: [{ role: "user", content: "hi" }] },
        "key-1",
        { config: relayConfig },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(primary).toHaveBeenCalledOnce();
    expect(backup).not.toHaveBeenCalled();
  });

  it("retries configured upstream statuses on the next target", async () => {
    const primary = vi
      .fn()
      .mockRejectedValueOnce(
        new UpstreamAnthropicMessagesApiError(429, '{"type":"error"}', "application/json"),
      );
    const backup = vi.fn().mockResolvedValueOnce({
      id: "msg-backup",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 2, output_tokens: 1 },
    });
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "fallback-group",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({ createAnthropicMessage: primary }),
        resolvedTarget({ createAnthropicMessage: backup }),
      ],
    });
    mockEstimateCost.mockReturnValueOnce(0.001);

    const result = await handleAnthropicMessage(
      { model: "claude-test", messages: [{ role: "user", content: "hi" }] },
      "key-1",
      { config: relayConfig },
    );

    expect(result).toMatchObject({ kind: "complete", response: { id: "msg-backup" } });
    expect(primary).toHaveBeenCalledOnce();
    expect(backup).toHaveBeenCalledOnce();
  });

  it("aborts a non-stream request at the configured timeout", async () => {
    const never = vi.fn(
      (_request, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [resolvedTarget({ createAnthropicMessage: never })],
    });

    await expect(
      handleAnthropicMessage(
        { model: "claude-test", messages: [{ role: "user", content: "hi" }] },
        "key-1",
        { config: { ...relayConfig, retryCount: 0, nonStreamTimeoutMs: 5 } },
      ),
    ).rejects.toBeInstanceOf(MessagesRelayTimeoutError);
    expect(never.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("reserves maximum liability and settles actual spend atomically", async () => {
    const reservation = {
      requestId: "req-1",
      limits: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      reservedUsd: 0.5,
    };
    mockReserveSpend.mockResolvedValueOnce(reservation);
    mockGetModelPricing.mockReturnValue({ maxOutputTokens: 1000 });
    mockEstimateCost.mockReturnValueOnce(0.5).mockReturnValueOnce(0.05);
    mockResolveAnthropicMessagesModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-test",
      targets: [
        resolvedTarget({
          createAnthropicMessage: vi.fn().mockResolvedValueOnce({
            id: "msg-1",
            type: "message",
            role: "assistant",
            model: "claude-test",
            content: [{ type: "text", text: "ok" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        }),
      ],
    });

    await handleAnthropicMessage(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      },
      "key-1",
      {
        requireBillableUsage: true,
        billing: { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
        requestId: "req-1",
        config: { ...relayConfig, retryCount: 0 },
      },
    );

    expect(mockReserveSpend).toHaveBeenCalledWith(
      { apiKeyId: "key-1", apiKeyLimitUsd: 1 },
      "req-1",
      0.5,
    );
    expect(mockSettleSpendReservation).toHaveBeenCalledWith(reservation, 0.05);
    expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
  });
});
