import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertApiKeyCanSpend,
  mockAddApiKeySpendUsd,
  mockEstimateCost,
  mockHandleAudioSpeech,
  mockHandleAudioSpeechStream,
  mockHandleAudioTranscription,
  mockHandleAudioTranscriptionStream,
  mockHandleAudioTranslation,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAssertApiKeyCanSpend: vi.fn(),
  mockAddApiKeySpendUsd: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleAudioSpeech: vi.fn(),
  mockHandleAudioSpeechStream: vi.fn(),
  mockHandleAudioTranscription: vi.fn(),
  mockHandleAudioTranscriptionStream: vi.fn(),
  mockHandleAudioTranslation: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/audio/services", () => ({
  createAudioUsageAccumulator: vi.fn((endpoint: string, contentType?: string) => {
    let body = "";
    return {
      push: (chunk: string | Uint8Array) => {
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        if (!contentType?.includes("text/event-stream")) {
          body += text;
          return {};
        }

        const usage: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        } = {};
        for (const rawLine of text.split("\n")) {
          if (!rawLine.startsWith("data: ")) continue;
          const data = rawLine.slice(6);
          if (data === "[DONE]") continue;
          const parsed = JSON.parse(data) as {
            usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
          };
          if (parsed.usage?.input_tokens !== undefined) {
            usage.promptTokens = parsed.usage.input_tokens;
          }
          if (parsed.usage?.output_tokens !== undefined) {
            usage.completionTokens = parsed.usage.output_tokens;
          }
          if (parsed.usage?.total_tokens !== undefined)
            usage.totalTokens = parsed.usage.total_tokens;
        }
        return usage;
      },
      final: () => {
        if (!contentType?.includes("json") || body.length === 0) return {};
        const parsed = JSON.parse(body) as {
          usage?: {
            type?: string;
            seconds?: number;
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          };
        };
        if (parsed.usage?.type === "duration" && typeof parsed.usage.seconds === "number") {
          const tokens = Math.round((Math.ceil(parsed.usage.seconds) / 60) * 1000);
          return endpoint === "/v1/audio/speech"
            ? { promptTokens: 0, completionTokens: tokens, totalTokens: tokens }
            : { promptTokens: tokens, completionTokens: 0, totalTokens: tokens };
        }
        return {
          promptTokens: parsed.usage?.input_tokens,
          completionTokens: parsed.usage?.output_tokens,
          totalTokens: parsed.usage?.total_tokens,
        };
      },
    };
  }),
  handleAudioSpeech: mockHandleAudioSpeech,
  handleAudioSpeechStream: mockHandleAudioSpeechStream,
  handleAudioTranscription: mockHandleAudioTranscription,
  handleAudioTranscriptionStream: mockHandleAudioTranscriptionStream,
  handleAudioTranslation: mockHandleAudioTranslation,
}));
vi.mock("../../../src/middleware/api-key", () => ({
  apiKeyAuth: vi
    .fn()
    .mockImplementation(
      async (c: { set: (key: string, value: unknown) => void }, next: () => void) => {
        c.set("apiKeyId", "key-1");
        c.set("apiKeySpendLimitUsd", mockSpendLimit.value);
        c.set("apiKeyAllowAllModels", mockModelAccess.allowAllModels);
        c.set("apiKeyIncludeFutureModels", mockModelAccess.includeFutureModels);
        c.set("apiKeyAllowedModelIds", mockModelAccess.allowedModelIds);
        await next();
      },
    ),
  readApiKeyModelAccess: vi.fn(() => mockModelAccess),
}));
vi.mock("../../../src/middleware/logger", () => {
  class RequestLoggingUnavailableError extends Error {}
  return {
    RequestLoggingUnavailableError,
    logStreamFinal: mockLogStreamFinal,
    logStreamStart: mockLogStreamStart,
  };
});
vi.mock("../../../src/providers/registry", () => ({
  estimateCost: mockEstimateCost,
}));
vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeyModelAccessDeniedError extends Error {
    constructor(modelId: string) {
      super(`API key is not allowed to use model: ${modelId}`);
      this.name = "ApiKeyModelAccessDeniedError";
    }
  }
  class ApiKeySpendLimitExceededError extends Error {
    constructor() {
      super("API key spend limit exceeded");
      this.name = "ApiKeySpendLimitExceededError";
    }
  }
  class ApiKeySpendLedgerUnavailableError extends Error {}

  return {
    ApiKeyModelAccessDeniedError,
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
    assertApiKeyModelAllowed: vi.fn(
      (modelId: string, access: { allowAllModels: boolean; allowedModelIds: string[] }) => {
        if (!access.allowAllModels && !access.allowedModelIds.includes(modelId)) {
          throw new ApiKeyModelAccessDeniedError(modelId);
        }
      },
    ),
  };
});

import { Hono } from "hono";
import { audioRouter } from "../../../src/modules/audio/router";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

function textBody(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function audioFile(): File {
  return new File(["audio"], "speech.wav", { type: "audio/wav" });
}

async function* streamChunks(
  chunks: Array<string | Uint8Array>,
): AsyncIterable<string | Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("audio router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
    mockEstimateCost.mockReturnValue(undefined);
    mockLogStreamStart.mockResolvedValue("log-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST /transcriptions 400 when file is missing", async () => {
    const formData = new FormData();
    formData.append("model", "whisper-1");

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);
    expect(mockHandleAudioTranscription).not.toHaveBeenCalled();
  });

  it("POST /transcriptions streams SSE when requested", async () => {
    mockHandleAudioTranscriptionStream.mockResolvedValueOnce({
      stream: streamChunks([
        'data: {"delta":"hel"}\n\n',
        'data: {"usage":{"input_tokens":11,"output_tokens":4,"total_tokens":15}}\n\n',
        "data: [DONE]\n\n",
      ]),
      contentType: "text/event-stream",
      provider: "openai",
      model: "openai:gpt-4o-transcribe",
      latencyMs: 25,
    });
    const formData = new FormData();
    formData.append("model", "gpt-4o-transcribe");
    formData.append("file", audioFile());
    formData.append("stream", "true");

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(res.text()).resolves.toBe(
      'data: {"delta":"hel"}\n\n' +
        'data: {"usage":{"input_tokens":11,"output_tokens":4,"total_tokens":15}}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(mockHandleAudioTranscription).not.toHaveBeenCalled();
    expect(mockHandleAudioTranscriptionStream).toHaveBeenCalledWith(
      expect.any(FormData),
      "gpt-4o-transcribe",
      "key-1",
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        model: "openai:gpt-4o-transcribe",
        endpoint: "/v1/audio/transcriptions",
        latencyMs: 25,
        promptTokens: 11,
        completionTokens: 4,
        totalTokens: 15,
        statusCode: 200,
      }),
    );
  });

  it("POST /transcriptions captures JSON usage when upstream ignores streaming", async () => {
    mockEstimateCost.mockReturnValueOnce(0.00003);
    mockHandleAudioTranscriptionStream.mockResolvedValueOnce({
      stream: streamChunks(['{"text":"hello","usage":{"type":"duration","seconds":9', "}}"]),
      contentType: "application/json",
      provider: "openai",
      model: "openai:whisper-1",
      latencyMs: 25,
    });
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", audioFile());
    formData.append("stream", "true");

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe(
      '{"text":"hello","usage":{"type":"duration","seconds":9}}',
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:whisper-1",
        endpoint: "/v1/audio/transcriptions",
        promptTokens: 150,
        completionTokens: 0,
        totalTokens: 150,
        estimatedCost: 0.00003,
        statusCode: 200,
      }),
    );
  });

  it("POST /transcriptions returns upstream content and content-type", async () => {
    mockHandleAudioTranscription.mockResolvedValueOnce({
      body: textBody('{"text":"hello"}'),
      contentType: "application/json",
    });
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", audioFile());

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe('{"text":"hello"}');
    expect(mockHandleAudioTranscription).toHaveBeenCalledWith(
      expect.any(FormData),
      "whisper-1",
      "key-1",
      { recordSpend: false },
    );
  });

  it("POST /translations returns upstream text responses", async () => {
    mockHandleAudioTranslation.mockResolvedValueOnce({
      body: textBody("hello"),
      contentType: "text/plain",
    });
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", audioFile());

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/translations", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    await expect(res.text()).resolves.toBe("hello");
    expect(mockHandleAudioTranslation).toHaveBeenCalledWith(
      expect.any(FormData),
      "whisper-1",
      "key-1",
      { recordSpend: false },
    );
  });

  it("POST /speech returns upstream audio bytes", async () => {
    mockHandleAudioSpeech.mockResolvedValueOnce({
      body: new Uint8Array([1, 2, 3]).buffer,
      contentType: "audio/mpeg",
    });

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", input: "hello", voice: "alloy" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(mockHandleAudioSpeech).toHaveBeenCalledWith(
      { model: "tts-1", input: "hello", voice: "alloy" },
      "key-1",
      { recordSpend: false },
    );
  });

  it("POST /speech streams SSE when requested", async () => {
    mockHandleAudioSpeechStream.mockResolvedValueOnce({
      stream: streamChunks([
        'data: {"type":"audio.delta"}\n\n',
        'data: {"usage":{"input_tokens":3,"output_tokens":8,"total_tokens":11}}\n\n',
        "data: [DONE]\n\n",
      ]),
      contentType: "text/event-stream",
      provider: "openai",
      model: "openai:gpt-4o-mini-tts",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        input: "hello",
        voice: "alloy",
        stream_format: "sse",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(res.text()).resolves.toBe(
      'data: {"type":"audio.delta"}\n\n' +
        'data: {"usage":{"input_tokens":3,"output_tokens":8,"total_tokens":11}}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(mockHandleAudioSpeech).not.toHaveBeenCalled();
    expect(mockHandleAudioSpeechStream).toHaveBeenCalledWith(
      { model: "tts-1", input: "hello", voice: "alloy", stream_format: "sse" },
      "key-1",
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        model: "openai:gpt-4o-mini-tts",
        endpoint: "/v1/audio/speech",
        promptTokens: 3,
        completionTokens: 8,
        totalTokens: 11,
        statusCode: 200,
      }),
    );
  });

  it("POST /speech streams raw audio bytes when audio stream format is requested", async () => {
    mockHandleAudioSpeechStream.mockResolvedValueOnce({
      stream: streamChunks([new Uint8Array([1, 2]), new Uint8Array([3, 4])]),
      contentType: "audio/mpeg",
      provider: "openai",
      model: "openai:gpt-4o-mini-tts",
      latencyMs: 25,
    });

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: "hello",
        voice: "alloy",
        stream_format: "audio",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(mockHandleAudioSpeech).not.toHaveBeenCalled();
    expect(mockHandleAudioSpeechStream).toHaveBeenCalledWith(
      {
        model: "gpt-4o-mini-tts",
        input: "hello",
        voice: "alloy",
        stream_format: "audio",
      },
      "key-1",
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai:gpt-4o-mini-tts",
        endpoint: "/v1/audio/speech",
        statusCode: 200,
      }),
    );
  });

  it("POST /speech returns upstream OpenAI-compatible errors verbatim", async () => {
    mockHandleAudioSpeech.mockRejectedValueOnce(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 400,
        body: '{"error":{"message":"bad voice"}}',
        contentType: "application/json",
      }),
    );

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", input: "hello", voice: "alloy" }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await expect(res.text()).resolves.toBe('{"error":{"message":"bad voice"}}');
  });
});
