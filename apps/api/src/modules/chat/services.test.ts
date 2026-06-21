import { afterEach, describe, expect, it, vi } from "vitest";

const { mockLogRequest, mockGetProvider } = vi.hoisted(() => ({
  mockLogRequest: vi.fn(),
  mockGetProvider: vi.fn(),
}));

vi.mock("../../middleware/logger", () => ({ logRequest: mockLogRequest }));
vi.mock("../../providers/registry", () => ({ getProvider: mockGetProvider }));

import { handleChatCompletion } from "./services";
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
    await expect(handleChatCompletion(createRequest(), "key-1")).rejects.toThrow("No provider found");
  });

  it("calls non-streaming completion and logs request", async () => {
    mockGetProvider.mockReturnValueOnce({
      name: "openai",
      chatCompletion: vi.fn().mockResolvedValueOnce({
        id: "chat-1", model: "gpt-4",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
    });

    const result = await handleChatCompletion(createRequest(), "key-1");
    expect(result.kind).toBe("complete");
    expect(mockLogRequest).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200 }));
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