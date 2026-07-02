import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertApiKeyCanSpend,
  mockHandleAudioSpeech,
  mockHandleAudioTranscription,
  mockHandleAudioTranslation,
  mockModelAccess,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAssertApiKeyCanSpend: vi.fn(),
  mockHandleAudioSpeech: vi.fn(),
  mockHandleAudioTranscription: vi.fn(),
  mockHandleAudioTranslation: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/audio/services", () => ({
  handleAudioSpeech: mockHandleAudioSpeech,
  handleAudioTranscription: mockHandleAudioTranscription,
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
  return { RequestLoggingUnavailableError };
});
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

describe("audio router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
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

  it("POST /transcriptions 422 when streaming is requested", async () => {
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", audioFile());
    formData.append("stream", "true");

    const app = new Hono().route("/v1/audio", audioRouter);
    const res = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(422);
    expect(mockHandleAudioTranscription).not.toHaveBeenCalled();
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

  it("POST /speech 422 when SSE streaming is requested", async () => {
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

    expect(res.status).toBe(422);
    expect(mockHandleAudioSpeech).not.toHaveBeenCalled();
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
