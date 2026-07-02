import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockGetModelPricing,
  mockLogRequest,
  mockResolveCompletionModel,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockGetModelPricing: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveCompletionModel: vi.fn(),
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
  resolveCompletionModel: mockResolveCompletionModel,
}));

import {
  ApiKeyUnbillableCompletionUsageError,
  handleCompletion,
} from "../../../src/modules/completions/services";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import type { CompletionRequest } from "../../../src/providers/types";

describe("completions services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (overrides?: Partial<CompletionRequest>): CompletionRequest => ({
    model: "openai:gpt-3.5-turbo-instruct",
    prompt: "hello",
    ...overrides,
  });

  const createResponse = (model: string) => ({
    id: "cmpl-1",
    model,
    choices: [{ text: "hi", index: 0 }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    overrides?: {
      createCompletion?: ReturnType<typeof vi.fn>;
      createCompletionStream?: ReturnType<typeof vi.fn>;
    },
  ) => ({
    provider: {
      name: provider,
      createCompletion:
        overrides?.createCompletion ?? vi.fn().mockResolvedValue(createResponse(modelId)),
      createCompletionStream: overrides?.createCompletionStream,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("creates a completion, logs usage, and records limited-key spend", async () => {
    const target = createResolvedModel("openai", "gpt-3.5-turbo-instruct");
    mockResolveCompletionModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-3.5-turbo-instruct",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValueOnce({ id: "gpt-3.5-turbo-instruct" });
    mockEstimateCost.mockReturnValueOnce(0.000012);

    const result = await handleCompletion(createRequest(), "key-1", {
      requireBillableUsage: true,
    });

    expect(result).toMatchObject({
      kind: "complete",
      response: { model: "openai:gpt-3.5-turbo-instruct" },
    });
    expect(target.provider.createCompletion).toHaveBeenCalledWith({
      model: "gpt-3.5-turbo-instruct",
      prompt: "hello",
    });
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.000012);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/completions",
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      }),
    );
  });

  it("rejects limited direct completions when pricing is unavailable", async () => {
    const target = createResolvedModel("openai", "gpt-3.5-turbo-instruct");
    mockResolveCompletionModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-3.5-turbo-instruct",
      targets: [target],
    });
    mockGetModelPricing.mockReturnValueOnce(null);

    await expect(
      handleCompletion(createRequest(), "key-1", { requireBillableUsage: true }),
    ).rejects.toBeInstanceOf(ApiKeyUnbillableCompletionUsageError);
    expect(target.provider.createCompletion).not.toHaveBeenCalled();
  });

  it("returns raw streams without parsing or rewriting chunks", async () => {
    async function* completionStream() {
      yield 'data: {"id":"cmpl-1","model":"gpt-3.5-turbo-instruct"}\n\n';
      yield "data: [DONE]\n\n";
    }

    const target = createResolvedModel("openai", "gpt-3.5-turbo-instruct", {
      createCompletionStream: vi.fn(() => completionStream()),
    });
    mockResolveCompletionModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "alias-completion",
      targets: [target],
    });

    const result = await handleCompletion(
      createRequest({ model: "alias-completion", stream: true }),
      "key-1",
    );

    expect(result.kind).toBe("stream");
    if (result.kind === "stream") {
      const chunks: string[] = [];
      for await (const chunk of result.stream) chunks.push(chunk);
      expect(chunks.join("")).toBe(
        'data: {"id":"cmpl-1","model":"gpt-3.5-turbo-instruct"}\n\n' + "data: [DONE]\n\n",
      );
      expect(result.model).toBe("openai:gpt-3.5-turbo-instruct");
    }
  });
});
