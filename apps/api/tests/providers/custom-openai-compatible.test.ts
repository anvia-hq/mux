import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

import { CustomOpenAICompatibleAdapter } from "../../src/providers/custom-openai-compatible";
import { UpstreamOpenAICompatibleError } from "../../src/providers/openai-compatible-error";
import type { Model } from "../../src/providers/types";

const models: Model[] = [
  {
    id: "embed",
    name: "Embed",
    provider: "custom",
    inputPricePer1M: 1,
    outputPricePer1M: 0,
    contextWindow: 8192,
    maxOutputTokens: 1536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
];

function makeSSEStream(chunks: string[]) {
  const encoder = new TextEncoder();
  const data = chunks.map((chunk) => encoder.encode(chunk));
  let index = 0;

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index < data.length) {
          controller.enqueue(data[index++]);
          return;
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("CustomOpenAICompatibleAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("advertises embeddings without enabling Responses", () => {
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
    });

    expect(adapter.capabilities.embeddingsApi).toBe(true);
    expect(adapter.capabilities.moderationsApi).toBe(true);
    expect(adapter.capabilities.imageGenerationsApi).toBe(true);
    expect(adapter.capabilities.completionsApi).toBe(true);
    expect(adapter.capabilities.audioTranscriptionsApi).toBe(true);
    expect(adapter.capabilities.audioTranslationsApi).toBe(true);
    expect(adapter.capabilities.audioSpeechApi).toBe(true);
    expect(adapter.capabilities.responsesTransport).toBeUndefined();
  });

  it("advertises explicit native and chat-converted Responses modes", () => {
    const native = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
      responsesMode: "native",
    });
    const viaChat = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
      responsesMode: "via_chat",
    });

    expect(native.capabilities.responsesTransport).toBe("native");
    expect(viaChat.capabilities.responsesTransport).toBe("chat");
  });

  it("uses the configured native Responses endpoint and reports upstream metadata", async () => {
    const upstream = Response.json(
      {
        id: "resp_1",
        object: "response",
        status: "completed",
        model: "embed",
        output: [],
      },
      { status: 201, headers: { "x-upstream": "yes" } },
    );
    mockFetch.mockResolvedValueOnce(upstream);
    const onResponse = vi.fn();
    const controller = new AbortController();
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
      responsesMode: "native",
      responsesEndpoint: "https://responses.example/api/responses",
    });

    const response = await adapter.createResponse(
      { model: "embed", input: "hello" },
      { signal: controller.signal, onResponse },
    );

    expect(response.id).toBe("resp_1");
    expect(onResponse).toHaveBeenCalledWith(upstream);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://responses.example/api/responses",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
      }),
    );
  });

  it("derives the native Responses endpoint from a chat-completions URL", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp_1",
        object: "response",
        status: "completed",
        model: "embed",
        output: [],
      }),
    );
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
      responsesMode: "native",
    });

    await adapter.createResponse({ model: "embed", input: "hello" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("supports native input-token and input-item operations with endpoint query parameters", async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ object: "response.input_tokens", input_tokens: 3 }))
      .mockResolvedValueOnce(Response.json({ object: "list", data: [] }));
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
      responsesMode: "native",
      responsesEndpoint: "https://responses.example/api/responses?api-version=preview",
    });

    await adapter.countResponseInputTokens?.({ model: "embed", input: "hello" });
    await adapter.listResponseInputItems?.("resp/1", { limit: "10" });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "https://responses.example/api/responses/input_tokens?api-version=preview",
    );
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(
      "https://responses.example/api/responses/resp%2F1/input_items?api-version=preview&limit=10",
    );
  });

  it("creates embeddings through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [{ object: "embedding", embedding: "base64-data", index: 0 }],
        model: "embed",
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
    );

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const controller = new AbortController();
    const onResponse = vi.fn();
    const response = await adapter.createEmbedding(
      {
        model: "embed",
        input: "hello",
        encoding_format: "base64",
      },
      { signal: controller.signal, onResponse },
    );

    expect(response.data[0]?.embedding).toBe("base64-data");
    expect(onResponse).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
  });

  it("raises status-aware embedding errors with Retry-After", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json(
        { error: { message: "busy" } },
        { status: 429, headers: { "retry-after": "7" } },
      ),
    );
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
    });

    await expect(adapter.createEmbedding({ model: "embed", input: "hello" })).rejects.toEqual(
      expect.objectContaining<Partial<UpstreamOpenAICompatibleError>>({
        status: 429,
        retryAfter: "7",
      }),
    );
  });

  it("creates completions through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "cmpl-1",
        model: "embed",
        choices: [{ text: "hi", index: 0 }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const response = await adapter.createCompletion({
      model: "embed",
      prompt: "hello",
    });

    expect(response.choices?.[0]?.text).toBe("hi");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
  });

  it("creates audio transcriptions through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ text: "hello" }));

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const formData = new FormData();
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    formData.append("file", file);
    formData.append("model", "client-model");

    await adapter.createAudioTranscription({ model: "embed", formData });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer k" },
      }),
    );
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("model")).toBe("embed");
    expect(requestBody.get("file")).toBe(file);
  });

  it("streams audio transcriptions through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(makeSSEStream(["data: hello\n\n"]));

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const formData = new FormData();
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    formData.append("file", file);
    formData.append("model", "client-model");

    const response = await adapter.createAudioTranscriptionStream({ model: "embed", formData });
    const chunks: string[] = [];
    for await (const chunk of response.stream) {
      expect(typeof chunk).toBe("string");
      chunks.push(String(chunk));
    }

    expect(response.contentType).toBe("text/event-stream");
    expect(chunks.join("")).toBe("data: hello\n\n");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer k" },
      }),
    );
    const requestBody = mockFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("model")).toBe("embed");
    expect(requestBody.get("file")).toBe(file);
  });

  it("creates audio speech through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } }),
    );

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const response = await adapter.createAudioSpeech({
      model: "embed",
      input: "hello",
      voice: "alloy",
    });

    expect(response.contentType).toBe("audio/mpeg");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
  });

  it("streams audio speech through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(makeSSEStream(["data: speech\n\n"]));

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const response = await adapter.createAudioSpeechStream({
      model: "embed",
      input: "hello",
      voice: "alloy",
      stream_format: "sse",
    });
    const chunks: string[] = [];
    for await (const chunk of response.stream) {
      expect(typeof chunk).toBe("string");
      chunks.push(String(chunk));
    }

    expect(response.contentType).toBe("text/event-stream");
    expect(chunks.join("")).toBe("data: speech\n\n");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "embed",
      input: "hello",
      voice: "alloy",
      stream_format: "sse",
    });
  });
});
