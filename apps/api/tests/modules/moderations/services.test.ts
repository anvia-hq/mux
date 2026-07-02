import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAddApiKeySpendUsd, mockEstimateCost, mockLogRequest, mockResolveModerationModel } =
  vi.hoisted(() => ({
    mockAddApiKeySpendUsd: vi.fn(),
    mockEstimateCost: vi.fn(),
    mockLogRequest: vi.fn(),
    mockResolveModerationModel: vi.fn(),
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
  resolveModerationModel: mockResolveModerationModel,
}));

import { handleModeration } from "../../../src/modules/moderations/services";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import type { ModerationRequest } from "../../../src/providers/types";

describe("moderations services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (
    overrides?: Partial<ModerationRequest>,
  ): ModerationRequest & { model: string } => ({
    model: "openai:text-moderation-latest",
    input: "hello",
    ...overrides,
  });

  const createResponse = (model: string, usage?: Record<string, number>) => ({
    id: "modr-1",
    model,
    results: [{ flagged: false }],
    usage,
  });

  const createResolvedModel = (
    provider: string,
    modelId: string,
    createModeration = vi.fn().mockResolvedValue(createResponse(modelId)),
  ) => ({
    provider: {
      name: provider,
      createModeration,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  });

  it("throws when no moderation-capable provider resolves", async () => {
    mockResolveModerationModel.mockResolvedValueOnce(null);

    await expect(handleModeration(createRequest(), "key-1")).rejects.toThrow("No provider found");
  });

  it("creates a moderation, logs usage, and returns the requested model id", async () => {
    const createModeration = vi.fn().mockResolvedValueOnce(
      createResponse("text-moderation-latest", {
        prompt_tokens: 5,
        completion_tokens: 0,
        total_tokens: 5,
      }),
    );
    const target = createResolvedModel("openai", "text-moderation-latest", createModeration);
    mockResolveModerationModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-moderation-latest",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.000001);

    const response = await handleModeration(createRequest(), "key-1");

    expect(response.model).toBe("openai:text-moderation-latest");
    expect(createModeration).toHaveBeenCalledWith({
      model: "text-moderation-latest",
      input: "hello",
    });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/moderations",
        model: "openai:text-moderation-latest",
        promptTokens: 5,
        estimatedCost: 0.000001,
        statusCode: 200,
      }),
    );
  });

  it("does not reject limited moderation responses without usage", async () => {
    const target = createResolvedModel(
      "openai",
      "text-moderation-latest",
      vi.fn().mockResolvedValueOnce(createResponse("text-moderation-latest")),
    );
    mockResolveModerationModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:text-moderation-latest",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(undefined);

    await expect(
      handleModeration(createRequest(), "key-1", { recordSpend: true }),
    ).resolves.toMatchObject({ model: "openai:text-moderation-latest" });
    expect(mockAddApiKeySpendUsd).not.toHaveBeenCalled();
  });
});
