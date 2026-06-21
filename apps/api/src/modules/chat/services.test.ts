import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEstimateCost, mockGetModelPricing, mockGetProvider, mockLogRequest } = vi.hoisted(
  () => ({
    mockEstimateCost: vi.fn(),
    mockGetModelPricing: vi.fn(),
    mockLogRequest: vi.fn(),
    mockGetProvider: vi.fn(),
  }),
);

vi.mock("../../middleware/logger", () => ({ logRequest: mockLogRequest }));
vi.mock("../../providers/registry", () => ({
  estimateCost: mockEstimateCost,
  getModelPricing: mockGetModelPricing,
  getProvider: mockGetProvider,
}));

import { ApiKeyUnbillableUsageError, handleChatCompletion } from "./services";
import type { ChatCompletionRequest } from "../../providers/types";

describe("chat services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (overrides?: Partial<ChatCompletionRequest>): ChatCompletionRequest => ({
    model: "gpt-4",
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  });

  it("throws when no provider found for model", async () => {
    mockGetProvider.mockReturnValueOnce(null);
    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toThrow(
      "No provider found",
    );
  });

  it("calls non-streaming completion and logs request", async () => {
    mockGetProvider.mockReturnValueOnce({
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
    });
    mockEstimateCost.mockReturnValueOnce(0.01);

    const result = await handleChatCompletion(createRequest(), "key-1");
    expect(result.kind).toBe("complete");
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCost: 0.01, statusCode: 200 }),
    );
  });

  it("throws when limited key request cannot be billed", async () => {
    mockGetProvider.mockReturnValueOnce({
      name: "openai",
      chatCompletion: vi.fn().mockResolvedValueOnce({
        id: "chat-1",
        model: "gpt-4",
        choices: [
          { index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-4" });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleChatCompletion(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableUsageError);
  });

  it("logs error on provider failure", async () => {
    mockGetProvider.mockReturnValueOnce({
      name: "openai",
      chatCompletion: vi.fn().mockRejectedValueOnce(new Error("API rate limit")),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
    });

    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toThrow("API rate limit");
    expect(mockLogRequest).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });
});
