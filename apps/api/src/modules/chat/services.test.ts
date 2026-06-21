import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEstimateCost, mockGetModelPricing, mockLogRequest, mockResolveProviderModel } =
  vi.hoisted(() => ({
    mockEstimateCost: vi.fn(),
    mockGetModelPricing: vi.fn(),
    mockLogRequest: vi.fn(),
    mockResolveProviderModel: vi.fn(),
  }));

vi.mock("../../middleware/logger", () => ({ logRequest: mockLogRequest }));
vi.mock("../../providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  resolveProviderModel: mockResolveProviderModel,
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

  it("throws when model is not provider-prefixed", async () => {
    mockResolveProviderModel.mockReturnValueOnce(null);
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
    mockResolveProviderModel.mockReturnValueOnce({
      modelId: "gpt-4",
      publicModelId: "openai:gpt-4",
      providerName: "openai",
      provider: {
        name: "openai",
        chatCompletion,
        chatCompletionStream: vi.fn(),
        listModels: vi.fn().mockReturnValue([]),
      },
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

    mockResolveProviderModel.mockReturnValueOnce({
      modelId: "gpt-4",
      publicModelId: "openai:gpt-4",
      providerName: "openai",
      provider: {
        name: "openai",
        chatCompletion: vi.fn(),
        chatCompletionStream: vi.fn().mockReturnValue(stream()),
        listModels: vi.fn().mockReturnValue([]),
      },
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
    mockResolveProviderModel.mockReturnValueOnce({
      modelId: "gpt-4",
      publicModelId: "openai:gpt-4",
      providerName: "openai",
      provider: {
        name: "openai",
        chatCompletion: vi.fn().mockResolvedValueOnce({
          id: "chat-1",
          model: "gpt-4",
          choices: [
            { index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        chatCompletionStream: vi.fn(),
        listModels: vi.fn().mockReturnValue([]),
      },
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleChatCompletion(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableUsageError);
  });

  it("logs error on provider failure", async () => {
    mockResolveProviderModel.mockReturnValueOnce({
      modelId: "gpt-4",
      publicModelId: "openai:gpt-4",
      providerName: "openai",
      provider: {
        name: "openai",
        chatCompletion: vi.fn().mockRejectedValueOnce(new Error("API rate limit")),
        chatCompletionStream: vi.fn(),
        listModels: vi.fn().mockReturnValue([]),
      },
    });

    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toThrow("API rate limit");
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-4", statusCode: 500 }),
    );
  });
});
