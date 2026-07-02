import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAddApiKeySpendUsd, mockEstimateCost, mockLogRequest, mockResolveImageGenerationModel } =
  vi.hoisted(() => ({
    mockAddApiKeySpendUsd: vi.fn(),
    mockEstimateCost: vi.fn(),
    mockLogRequest: vi.fn(),
    mockResolveImageGenerationModel: vi.fn(),
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
  resolveImageGenerationModel: mockResolveImageGenerationModel,
}));

import { handleImageGeneration } from "../../../src/modules/images/services";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import type { ImageGenerationRequest } from "../../../src/providers/types";

describe("image generation services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest => ({
    model: "openai:gpt-image-1",
    prompt: "cat",
    ...overrides,
  });

  const createResponse = () => ({
    created: 1,
    data: [{ url: "https://example.test/cat.png" }],
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    overrides?: {
      createImageGeneration?: ReturnType<typeof vi.fn>;
      createImageGenerationStream?: ReturnType<typeof vi.fn>;
    },
  ) => ({
    provider: {
      name: provider,
      createImageGeneration:
        overrides?.createImageGeneration ?? vi.fn().mockResolvedValue(createResponse()),
      createImageGenerationStream: overrides?.createImageGenerationStream,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("creates an image generation, logs usage, and records limited-key spend", async () => {
    const target = createResolvedModel("openai", "gpt-image-1");
    mockResolveImageGenerationModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:gpt-image-1",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.00002);

    const result = await handleImageGeneration(createRequest(), "key-1", { recordSpend: true });

    expect(result).toMatchObject({
      kind: "complete",
      response: { created: 1, data: [{ url: "https://example.test/cat.png" }] },
    });
    expect(target.provider.createImageGeneration).toHaveBeenCalledWith({
      model: "gpt-image-1",
      prompt: "cat",
    });
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:gpt-image-1", 5, 7);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.00002);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/images/generations",
        promptTokens: 5,
        completionTokens: 7,
        totalTokens: 12,
      }),
    );
  });

  it("falls back before returning an image stream", async () => {
    async function* failedStream() {
      yield await Promise.reject(new Error("rate limited"));
    }
    async function* backupStream() {
      yield "data: partial\n\n";
    }

    const primary = createResolvedModel("openai", "gpt-image-1", {
      createImageGenerationStream: vi.fn(() => failedStream()),
    });
    const backup = createResolvedModel("custom", "image", {
      createImageGenerationStream: vi.fn(() => backupStream()),
    });
    mockResolveImageGenerationModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "images",
      name: "Images",
      description: null,
      requestedModelId: "mux:images",
      targets: [primary, backup],
    });

    const result = await handleImageGeneration(
      createRequest({ model: "mux:images", stream: true }),
      "key-1",
    );

    expect(result.kind).toBe("stream");
    if (result.kind === "stream") {
      const chunks: string[] = [];
      for await (const chunk of result.stream) chunks.push(chunk);
      expect(chunks).toEqual(["data: partial\n\n"]);
      expect(result.model).toBe("custom:image");
    }
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-image-1", statusCode: 500 }),
    );
  });
});
