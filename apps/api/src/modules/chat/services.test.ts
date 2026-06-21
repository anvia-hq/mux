import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEstimateCost, mockGetModelPricing, mockLogRequest, mockResolveChatModel } = vi.hoisted(
  () => ({
    mockEstimateCost: vi.fn(),
    mockGetModelPricing: vi.fn(),
    mockLogRequest: vi.fn(),
    mockResolveChatModel: vi.fn(),
  }),
);

vi.mock("../../middleware/logger", () => ({ logRequest: mockLogRequest }));
vi.mock("../../providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  resolveChatModel: mockResolveChatModel,
}));

import { ApiKeyUnbillableUsageError, handleChatCompletion } from "./services";
import type { ChatCompletionRequest } from "../../providers/types";

describe("chat services", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
      listModels: vi.fn().mockReturnValue([]),
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
    expect(chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4" }));
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCost: 0.01, model: "openai:gpt-4", statusCode: 200 }),
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
      expect.objectContaining({ model: "openai:gpt-4", statusCode: 500 }),
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
      expect.objectContaining({ model: "openai:gpt-4", statusCode: 500 }),
    );
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic:claude-3-haiku", statusCode: 200 }),
    );
  });
});
