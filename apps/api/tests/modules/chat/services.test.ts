import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockLogRequest,
  mockResolveChatModel,
  mockReserveChatSpend,
  mockSettleChatSpend,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveChatModel: vi.fn(),
  mockReserveChatSpend: vi.fn(),
  mockSettleChatSpend: vi.fn(),
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
vi.mock("../../../src/modules/chat/relay/billing", () => ({
  expandChatSpendReservation: vi.fn(),
  refundChatSpendReservation: vi.fn(),
  reserveChatSpend: mockReserveChatSpend,
  settleChatSpendReservation: mockSettleChatSpend,
}));
vi.mock("../../../src/providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  resolveChatModel: mockResolveChatModel,
}));

import {
  ApiKeyUnbillableUsageError,
  handleChatCompletion,
} from "../../../src/modules/chat/services";
import type { ChatCompletionRequest } from "../../../src/providers/types";
import {
  openAICompatibleCapabilities,
  unsupportedNativeCapabilities,
} from "../../../src/providers/chat-compat";
import { ChannelParamOverrideConfigError } from "../../../src/providers/channel-overrides";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";
import { readChatRelayConfig } from "../../../src/modules/chat/relay/config";
import {
  ChatRelayProtocolError,
  ChatRelayTimeoutError,
} from "../../../src/modules/chat/relay/errors";

describe("chat services", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const createRequest = (overrides?: Partial<ChatCompletionRequest>): ChatCompletionRequest => ({
    model: "openai:gpt-4",
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    overrides?: {
      chatCompletion?: ReturnType<typeof vi.fn>;
      chatCompletionStream?: ReturnType<typeof vi.fn>;
    },
  ) => ({
    provider: {
      name: provider,
      chatCompletion: overrides?.chatCompletion ?? vi.fn(),
      chatCompletionStream: overrides?.chatCompletionStream ?? vi.fn(),
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
      capabilities:
        provider === "openai" ? openAICompatibleCapabilities : unsupportedNativeCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("throws when model is not provider-prefixed", async () => {
    mockResolveChatModel.mockResolvedValueOnce(null);
    await expect(handleChatCompletion(createRequest({ model: "gpt-4" }), "key-1")).rejects.toThrow(
      "No provider found",
    );
  });

  it("calls non-streaming completion and logs request", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletion })],
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleChatCompletion(createRequest(), "key-1");
    expect(result).toMatchObject({ kind: "complete", response: { model: "openai:gpt-4" } });
    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCost: 0.01, model: "openai:gpt-4", statusCode: 200 }),
    );
  });

  it("applies channel body and header overrides before calling the provider", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        {
          ...createResolvedModel("openai", "gpt-4", { chatCompletion }),
          apiKey: "sk-upstream",
          headerOverride: {
            "X-Trace": "{client_header:X-Trace}",
            "X-Key": "{api_key}",
          },
          paramOverride: { temperature: 0 },
        },
      ],
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    await handleChatCompletion(createRequest({ temperature: 1 }), "key-1", {
      requestContext: { clientHeaders: new Headers({ "X-Trace": "trace-123" }) },
    });

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4", temperature: 0 }),
      expect.objectContaining({
        headers: {
          "x-key": "sk-upstream",
          "x-trace": "trace-123",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("passes the original raw body for pass-through channels", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const rawBody =
      '{\n  "model": "openai:gpt-4",\n  "messages": [{"role":"user","content":"hi"}]\n}';

    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        {
          ...createResolvedModel("openai", "gpt-4", { chatCompletion }),
          settings: { passThroughBodyEnabled: true },
          paramOverride: { temperature: 0 },
        },
      ],
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    await handleChatCompletion(createRequest({ temperature: 1 }), "key-1", { rawBody });

    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4", temperature: 1 }),
      expect.objectContaining({ headers: {}, rawBody, signal: expect.any(AbortSignal) }),
    );
  });

  it("prefixes streaming chunks", async () => {
    async function* stream() {
      yield { id: "chunk-1", model: "gpt-4", choices: [] };
    }

    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        createResolvedModel("openai", "gpt-4", {
          chatCompletionStream: vi.fn().mockReturnValue(stream()),
        }),
      ],
    });

    const result = await handleChatCompletion(createRequest({ stream: true }), "key-1");
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") return;
    const chunks = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ id: "chunk-1", model: "openai:gpt-4", choices: [] }]);
  });

  it("throws when limited key request cannot be billed", async () => {
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        createResolvedModel("openai", "gpt-4", {
          chatCompletion: vi.fn().mockResolvedValueOnce({
            id: "chat-1",
            model: "gpt-4",
            choices: [
              { index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        }),
      ],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleChatCompletion(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableUsageError);
  });

  it("records spend for limited successful requests before returning", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletion })],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleChatCompletion(createRequest(), "key-1", {
      requireBillableUsage: true,
    });

    expect(result).toMatchObject({ kind: "complete" });
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCost: 0.01, statusCode: 200 }),
    );
  });

  it("precharges 500 input tokens plus the explicit output cap and settles actual usage", async () => {
    const billing = {
      apiKeyId: "key-1",
      ownerId: "user-1",
      apiKeyLimitUsd: 1,
      ownerLimitUsd: 2,
    };
    const reservation = { requestId: "request-1", limits: billing, reservedUsd: 0.5 };
    mockReserveChatSpend.mockResolvedValueOnce(reservation);
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(0.5).mockReturnValueOnce(0.1);
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletion })],
    });

    await handleChatCompletion(createRequest({ max_completion_tokens: 200 }), "key-1", {
      requireBillableUsage: true,
      billing,
      requestId: "request-1",
    });

    expect(mockEstimateCost).toHaveBeenNthCalledWith(1, "openai:gpt-4", 500, 200);
    expect(mockReserveChatSpend).toHaveBeenCalledWith(billing, "request-1", 0.5);
    expect(mockSettleChatSpend).toHaveBeenCalledWith(reservation, 0.1);
  });

  it("uses concrete target pricing while returning and logging the requested alias", async () => {
    const chatCompletion = vi.fn().mockResolvedValueOnce({
      id: "chat-1",
      model: "gpt-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "fast-chat",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletion })],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleChatCompletion(createRequest({ model: "fast-chat" }), "key-1", {
      requireBillableUsage: true,
    });

    expect(result).toMatchObject({ kind: "complete", response: { model: "fast-chat" } });
    expect(chatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockGetModelPricing).toHaveBeenCalledWith("openai:gpt-4");
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-4", 10, 20, undefined, undefined);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:gpt-4",
        requestedModel: "fast-chat",
        statusCode: 200,
      }),
    );
  });

  it("logs error on provider failure", async () => {
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        createResolvedModel("openai", "gpt-4", {
          chatCompletion: vi.fn().mockRejectedValueOnce(new Error("API rate limit")),
        }),
      ],
    });

    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toThrow("API rate limit");
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-4", statusCode: 502 }),
    );
  });

  it("falls back across virtual model targets and returns requested model id", async () => {
    const primary = createResolvedModel("openai", "gpt-4", {
      chatCompletion: vi.fn().mockRejectedValueOnce(new Error("rate limited")),
    });
    const backup = createResolvedModel("anthropic", "claude-3-haiku", {
      chatCompletion: vi.fn().mockResolvedValueOnce({
        id: "chat-2",
        model: "claude-3-haiku",
        choices: [
          { index: 0, message: { role: "assistant", content: "backup" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      }),
    });

    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "fast-chat",
      name: "Fast chat",
      description: null,
      requestedModelId: "mux:fast-chat",
      targets: [primary, backup],
    });
    mockEstimateCost.mockReturnValueOnce(0.002);

    const result = await handleChatCompletion(createRequest({ model: "mux:fast-chat" }), "key-1");

    expect(result).toMatchObject({ kind: "complete", response: { model: "mux:fast-chat" } });
    expect(primary.provider.chatCompletion).toHaveBeenCalled();
    expect(backup.provider.chatCompletion).toHaveBeenCalled();
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-4", statusCode: 502 }),
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic:claude-3-haiku", statusCode: 200 }),
    );
  });

  it("retries configured upstream statuses on the next candidate", async () => {
    const primary = createResolvedModel("openai", "gpt-4", {
      chatCompletion: vi.fn().mockRejectedValueOnce(
        new UpstreamOpenAICompatibleError({
          provider: "openai",
          status: 429,
          body: JSON.stringify({ error: { message: "rate limited" } }),
        }),
      ),
    });
    const backup = createResolvedModel("openai", "gpt-4o", {
      chatCompletion: vi.fn().mockResolvedValueOnce({
        id: "chat-backup",
        model: "gpt-4o",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "fast-chat",
      name: "Fast chat",
      description: null,
      requestedModelId: "mux:fast-chat",
      targets: [primary, backup],
    });

    await expect(
      handleChatCompletion(createRequest({ model: "mux:fast-chat" }), "key-1"),
    ).resolves.toMatchObject({ kind: "complete", response: { model: "mux:fast-chat" } });
    expect(primary.provider.chatCompletion).toHaveBeenCalledOnce();
    expect(backup.provider.chatCompletion).toHaveBeenCalledOnce();
  });

  it("does not retry an upstream status outside the configured ranges", async () => {
    const primaryError = new UpstreamOpenAICompatibleError({
      provider: "openai",
      status: 400,
      body: JSON.stringify({ error: { message: "invalid request" } }),
    });
    const primary = createResolvedModel("openai", "gpt-4", {
      chatCompletion: vi.fn().mockRejectedValueOnce(primaryError),
    });
    const backup = createResolvedModel("openai", "gpt-4o", {
      chatCompletion: vi.fn(),
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "fast-chat",
      name: "Fast chat",
      description: null,
      requestedModelId: "mux:fast-chat",
      targets: [primary, backup],
    });

    await expect(
      handleChatCompletion(createRequest({ model: "mux:fast-chat" }), "key-1"),
    ).rejects.toBe(primaryError);
    expect(primary.provider.chatCompletion).toHaveBeenCalledOnce();
    expect(backup.provider.chatCompletion).not.toHaveBeenCalled();
  });

  it("measures each fallback provider attempt independently", async () => {
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const primary = createResolvedModel("openai", "gpt-4", {
      chatCompletion: vi.fn().mockImplementationOnce(async () => {
        now += 100;
        throw new Error("rate limited");
      }),
    });
    const backup = createResolvedModel("anthropic", "claude-3-haiku", {
      chatCompletion: vi.fn().mockImplementationOnce(async () => {
        now += 30;
        return {
          id: "chat-2",
          model: "claude-3-haiku",
          choices: [
            { index: 0, message: { role: "assistant", content: "backup" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        };
      }),
    });

    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "fast-chat",
      name: "Fast chat",
      description: null,
      requestedModelId: "mux:fast-chat",
      targets: [primary, backup],
    });

    await handleChatCompletion(createRequest({ model: "mux:fast-chat" }), "key-1");

    expect(mockLogRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "openai:gpt-4", latencyMs: 100, statusCode: 502 }),
    );
    expect(mockLogRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: "anthropic:claude-3-haiku",
        latencyMs: 30,
        statusCode: 200,
      }),
    );
    dateNow.mockRestore();
  });

  it("captures streaming latency at the first provider chunk", async () => {
    let now = 2_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    async function* streamChunks() {
      now += 40;
      yield { id: "chunk-1", model: "gpt-4", choices: [] };
      now += 500;
      yield { id: "chunk-2", model: "gpt-4", choices: [] };
    }
    const target = createResolvedModel("openai", "gpt-4", {
      chatCompletionStream: vi.fn().mockReturnValue(streamChunks()),
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [target],
    });

    const result = await handleChatCompletion(createRequest({ stream: true }), "key-1");

    expect(result).toMatchObject({ kind: "stream", latencyMs: 40 });
    if (result.kind === "stream") {
      for await (const _chunk of result.stream) {
        // Consume the remaining stream to prove later chunks do not change the captured value.
      }
      expect(result.latencyMs).toBe(40);
    }
    dateNow.mockRestore();
  });

  it("settles a partial stream from observed tokens when no usage chunk arrives", async () => {
    async function* streamChunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "partial answer" }, finish_reason: null }],
      };
    }
    const target = createResolvedModel("openai", "gpt-4", {
      chatCompletionStream: vi.fn().mockReturnValue(streamChunks()),
    });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.001);

    const result = await handleChatCompletion(createRequest({ stream: true }), "key-1");
    if (result.kind !== "stream") throw new Error("expected stream");
    for await (const _chunk of result.stream) {
      // Consume observed output before settlement.
    }
    await expect(result.finalizeSpend({})).resolves.toBe(0.001);
    expect(mockEstimateCost).toHaveBeenCalledWith(
      "openai:gpt-4",
      expect.any(Number),
      expect.any(Number),
      undefined,
      undefined,
    );
    const [, promptTokens, completionTokens] = mockEstimateCost.mock.calls[0];
    expect(promptTokens).toBeGreaterThan(0);
    expect(promptTokens).toBeLessThan(500);
    expect(completionTokens).toBeGreaterThan(0);
  });

  it("times out a stalled non-streaming upstream and aborts its signal", async () => {
    let providerSignal: AbortSignal | undefined;
    const chatCompletion = vi
      .fn()
      .mockImplementation((_request, options: { signal?: AbortSignal }) => {
        providerSignal = options.signal;
        return new Promise(() => undefined);
      });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletion })],
    });
    const config = readChatRelayConfig({
      CHAT_RETRY_COUNT: "0",
      CHAT_NON_STREAM_TIMEOUT_MS: "1",
    });

    await expect(handleChatCompletion(createRequest(), "key-1", { config })).rejects.toBeInstanceOf(
      ChatRelayTimeoutError,
    );
    expect(providerSignal?.aborted).toBe(true);
  });

  it("times out before the first stream event without waiting for an unresponsive iterator", async () => {
    let providerSignal: AbortSignal | undefined;
    async function* stalledStream() {
      await new Promise(() => undefined);
      yield { id: "never", model: "gpt-4", choices: [] };
    }
    const chatCompletionStream = vi
      .fn()
      .mockImplementation((_request, options: { signal?: AbortSignal }) => {
        providerSignal = options.signal;
        return stalledStream();
      });
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [createResolvedModel("openai", "gpt-4", { chatCompletionStream })],
    });
    const config = readChatRelayConfig({
      CHAT_RETRY_COUNT: "0",
      CHAT_FIRST_BYTE_TIMEOUT_MS: "1",
    });

    await expect(
      handleChatCompletion(createRequest({ stream: true }), "key-1", { config }),
    ).rejects.toMatchObject({ phase: "first_byte" });
    expect(providerSignal?.aborted).toBe(true);
  });

  it("times out an idle stream without waiting for an unresponsive iterator", async () => {
    async function* idleStream() {
      yield { id: "chunk-1", model: "gpt-4", choices: [] };
      await new Promise(() => undefined);
      yield { id: "never", model: "gpt-4", choices: [] };
    }
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        createResolvedModel("openai", "gpt-4", {
          chatCompletionStream: vi.fn().mockReturnValue(idleStream()),
        }),
      ],
    });
    const config = readChatRelayConfig({ CHAT_STREAM_IDLE_TIMEOUT_MS: "1" });

    const result = await handleChatCompletion(createRequest({ stream: true }), "key-1", { config });
    if (result.kind !== "stream") throw new Error("expected stream");
    const iterator = result.stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).rejects.toMatchObject({ phase: "idle" });
  });

  it("normalizes malformed upstream JSON as a protocol failure", async () => {
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-4",
      targets: [
        createResolvedModel("openai", "gpt-4", {
          chatCompletion: vi.fn().mockRejectedValueOnce(new SyntaxError("Unexpected token <")),
        }),
      ],
    });

    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toBeInstanceOf(
      ChatRelayProtocolError,
    );
  });

  it("does not fallback when channel param override config is invalid", async () => {
    const primary = {
      ...createResolvedModel("openai", "gpt-4", {
        chatCompletion: vi.fn(),
      }),
      paramOverride: {
        operations: [
          {
            mode: "return_error",
            value: { message: "bad channel config", status_code: 99 },
          },
        ],
      },
    };
    const backup = createResolvedModel("openai", "gpt-4o", {
      chatCompletion: vi.fn().mockResolvedValueOnce({
        id: "chat-backup",
        model: "gpt-4o",
        choices: [
          { index: 0, message: { role: "assistant", content: "backup" }, finish_reason: "stop" },
        ],
      }),
    });

    mockResolveChatModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "fast-chat",
      name: "Fast chat",
      description: null,
      requestedModelId: "mux:fast-chat",
      targets: [primary, backup],
    });

    await expect(
      handleChatCompletion(createRequest({ model: "mux:fast-chat" }), "key-1"),
    ).rejects.toBeInstanceOf(ChannelParamOverrideConfigError);
    expect(primary.provider.chatCompletion).not.toHaveBeenCalled();
    expect(backup.provider.chatCompletion).not.toHaveBeenCalled();
    expect(mockLogRequest).not.toHaveBeenCalled();
  });

  it("fails fast when a direct model cannot support requested features", async () => {
    mockResolveChatModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "anthropic:claude-3-haiku",
      targets: [
        {
          ...createResolvedModel("anthropic", "claude-3-haiku"),
          provider: {
            ...createResolvedModel("anthropic", "claude-3-haiku").provider,
            capabilities: unsupportedNativeCapabilities,
            listModels: vi.fn().mockReturnValue([
              {
                id: "claude-3-haiku",
                name: "Claude",
                provider: "anthropic",
                inputPricePer1M: 1,
                outputPricePer1M: 1,
                contextWindow: 1,
                maxOutputTokens: 1,
                inputModalities: ["text"],
                outputModalities: ["text"],
                reasoning: false,
                toolCall: false,
                structuredOutput: false,
                weights: "closed",
              },
            ]),
          },
        },
      ],
    });

    await expect(
      handleChatCompletion(
        createRequest({
          response_format: { type: "json_object" },
        }),
        "key-1",
      ),
    ).rejects.toThrow("does not support requested feature");
  });
});
