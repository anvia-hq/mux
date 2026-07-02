import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockLogRequest,
  mockResolveAudioSpeechModel,
  mockResolveAudioSpeechStreamModel,
  mockResolveAudioTranscriptionModel,
  mockResolveAudioTranscriptionStreamModel,
  mockResolveAudioTranslationModel,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockLogRequest: vi.fn(),
  mockResolveAudioSpeechModel: vi.fn(),
  mockResolveAudioSpeechStreamModel: vi.fn(),
  mockResolveAudioTranscriptionModel: vi.fn(),
  mockResolveAudioTranscriptionStreamModel: vi.fn(),
  mockResolveAudioTranslationModel: vi.fn(),
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
  resolveAudioSpeechModel: mockResolveAudioSpeechModel,
  resolveAudioSpeechStreamModel: mockResolveAudioSpeechStreamModel,
  resolveAudioTranscriptionModel: mockResolveAudioTranscriptionModel,
  resolveAudioTranscriptionStreamModel: mockResolveAudioTranscriptionStreamModel,
  resolveAudioTranslationModel: mockResolveAudioTranslationModel,
}));

import {
  createAudioUsageAccumulator,
  extractAudioUsage,
  extractAudioUsageFromRawSseChunk,
  handleAudioTranscription,
  handleAudioTranscriptionStream,
} from "../../../src/modules/audio/services";
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
      createAudioTranscriptionStream: vi.fn().mockResolvedValue({
        stream: streamChunks(["data: {}\n\n"]),
        contentType: "text/event-stream",
      }),
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      listModels: vi.fn().mockReturnValue([]),
      capabilities: openAICompatibleCapabilities,
    },
    providerName: provider,
    channelId: `${provider}-channel`,
    channelName: provider,
    modelId,
    upstreamModelId: modelId,
    publicModelId: `${provider}:${modelId}`,
  };
}

async function* streamChunks(
  chunks: Array<string | Uint8Array>,
): AsyncIterable<string | Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
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
        channelId: "openai-channel",
        channelName: "openai",
        endpoint: "/v1/audio/transcriptions",
        promptTokens: 5,
        completionTokens: 2,
        totalTokens: 7,
        estimatedCost: 0.00001,
        statusCode: 200,
      }),
    );
  });

  it("uses duration usage for audio accounting", async () => {
    const createAudioTranscription = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode('{"text":"hello"}').buffer,
      contentType: "application/json",
      usage: { type: "duration", seconds: 1.2 },
    });
    const target = createResolvedModel("openai", "public-transcribe", createAudioTranscription);
    target.upstreamModelId = "whisper-1";
    mockResolveAudioTranscriptionModel.mockResolvedValueOnce({
      kind: "direct",
      requestedModelId: "openai:public-transcribe",
      targets: [target],
    });
    mockEstimateCost.mockReturnValueOnce(0.00002);

    await handleAudioTranscription(createFormData(), "openai:public-transcribe", "key-1", {
      recordSpend: true,
    });

    expect(createAudioTranscription).toHaveBeenCalledWith({
      model: "whisper-1",
      formData: expect.any(FormData),
    });
    expect(mockEstimateCost).toHaveBeenCalledWith("openai:public-transcribe", 33, 0);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.00002);
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 33,
        completionTokens: 0,
        totalTokens: 33,
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

  it("prefetches stream output and falls back before returning a transcription stream", async () => {
    const primary = createResolvedModel("openai", "gpt-4o-transcribe");
    primary.provider.createAudioTranscriptionStream = vi.fn().mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 429,
        body: "rate limited",
      }),
    );
    const backup = createResolvedModel("custom", "public-transcribe");
    backup.upstreamModelId = "upstream-transcribe";
    backup.provider.createAudioTranscriptionStream = vi.fn().mockResolvedValueOnce({
      stream: streamChunks(["data: first\n\n", "data: second\n\n"]),
      contentType: "text/event-stream",
    });
    mockResolveAudioTranscriptionStreamModel.mockResolvedValueOnce({
      kind: "fallback-group",
      groupId: "audio",
      name: "Audio",
      description: null,
      requestedModelId: "mux:audio",
      targets: [primary, backup],
    });

    const result = await handleAudioTranscriptionStream(createFormData(), "mux:audio", "key-1");
    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      expect(typeof chunk).toBe("string");
      chunks.push(String(chunk));
    }

    expect(chunks).toEqual(["data: first\n\n", "data: second\n\n"]);
    expect(result).toMatchObject({
      contentType: "text/event-stream",
      provider: "custom",
      model: "custom:public-transcribe",
      channelId: "custom-channel",
      channelName: "custom",
    });
    expect(mockLogRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:gpt-4o-transcribe",
        endpoint: "/v1/audio/transcriptions",
        statusCode: 429,
      }),
    );
    expect(backup.provider.createAudioTranscriptionStream).toHaveBeenCalledWith({
      model: "upstream-transcribe",
      formData: expect.any(FormData),
    });
  });

  it("extracts token and duration usage from audio SSE chunks", () => {
    expect(
      extractAudioUsageFromRawSseChunk(
        'data: {"usage":{"input_tokens":7,"output_tokens":5,"total_tokens":12}}\n\n',
        "/v1/audio/transcriptions",
      ),
    ).toEqual({ promptTokens: 7, completionTokens: 5, totalTokens: 12 });

    expect(extractAudioUsage({ type: "duration", seconds: 62 }, "/v1/audio/speech")).toEqual({
      promptTokens: 0,
      completionTokens: 1033,
      totalTokens: 1033,
    });
  });

  it("accumulates split SSE usage lines", () => {
    const accumulator = createAudioUsageAccumulator(
      "/v1/audio/transcriptions",
      "text/event-stream",
    );

    expect(accumulator.push('data: {"usage":{"input_tokens":')).toEqual({});
    expect(accumulator.push('7,"output_tokens":5,"total_tokens":12}}\n\n')).toEqual({
      promptTokens: 7,
      completionTokens: 5,
      totalTokens: 12,
    });
    expect(accumulator.final()).toEqual({});
  });

  it("extracts usage from streamed JSON bodies", () => {
    const accumulator = createAudioUsageAccumulator("/v1/audio/transcriptions", "application/json");

    expect(accumulator.push('{"text":"hello","usage":{"type":"duration","seconds":9')).toEqual({});
    expect(accumulator.push("}}")).toEqual({});
    expect(accumulator.final()).toEqual({
      promptTokens: 150,
      completionTokens: 0,
      totalTokens: 150,
    });
  });
});
