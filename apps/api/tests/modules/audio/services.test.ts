import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockLogRequest,
  mockResolveAudioTranscriptionModel,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveAudioTranscriptionModel: vi.fn(),
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
  resolveAudioTranscriptionModel: mockResolveAudioTranscriptionModel,
}));

import { handleAudioTranscription } from "../../../src/modules/audio/services";
import { openAICompatibleCapabilities } from "../../../src/providers/chat-compat";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

function createFormData(): FormData {
  const formData = new FormData();
  formData.append("model", "openai:whisper-1");
  formData.append("file", new File(["audio"], "speech.wav", { type: "audio/wav" }));
  return formData;
}

function createResolvedModel(
  provider: string,
  modelId: string,
  createAudioTranscription = vi.fn().mockResolvedValue({
    body: new TextEncoder().encode('{"text":"hello"}').buffer,
    contentType: "application/json",
    usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
  }),
) {
  return {
    provider: {
      name: provider,
      createAudioTranscription,
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    modelId,
    publicModelId: `${provider}:${modelId}`,
  };
}

describe("audio services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a transcription, logs usage, and records limited-key spend", async () => {
    const target = createResolvedModel("openai", "whisper-1");
    mockResolveAudioTranscriptionModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:whisper-1",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.00001);

    const response = await handleAudioTranscription(createFormData(), "openai:whisper-1", "key-1", {
      recordSpend: true,
    });

    expect(new TextDecoder().decode(response.body)).toBe('{"text":"hello"}');
    expect(target.provider.createAudioTranscription).toHaveBeenCalledWith({
      model: "whisper-1",
      formData: expect.any(FormData),
    });
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:whisper-1", 5, 2);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.00001);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/v1/audio/transcriptions",
        promptTokens: 5,
        completionTokens: 2,
        totalTokens: 7,
        estimatedCost: 0.00001,
        statusCode: 200,
      }),
    );
  });

  it("falls back after upstream errors and logs the upstream status", async () => {
    const primary = createResolvedModel(
      "openai",
      "whisper-1",
      vi.fn().mockRejectedValueOnce(
        new UpstreamOpenAICompatibleError({
          provider: "openai",
          status: 429,
          body: "rate limited",
        }),
      ),
    );
    const backup = createResolvedModel("custom", "transcribe");
    mockResolveAudioTranscriptionModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "audio",
      name: "Audio",
      description: null,
      requestedModelId: "mux:audio",
      targets: [primary, backup],
    });

    const response = await handleAudioTranscription(createFormData(), "mux:audio", "key-1");

    expect(new TextDecoder().decode(response.body)).toBe('{"text":"hello"}');
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:whisper-1",
        endpoint: "/v1/audio/transcriptions",
        statusCode: 429,
      }),
    );
    expect(backup.provider.createAudioTranscription).toHaveBeenCalledWith({
      model: "transcribe",
      formData: expect.any(FormData),
    });
  });
});
