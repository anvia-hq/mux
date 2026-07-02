import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGlobalFetch } = vi.hoisted(() => ({
  mockGlobalFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockGlobalFetch);

import { ModelsDevProviderAdapter } from "../../src/providers/models-dev-provider-adapter";
import type { Model } from "../../src/providers/types";

const testModels: Model[] = [
  {
    id: "m1",
    name: "M1",
    provider: "t",
    inputPricePer1M: 1,
    outputPricePer1M: 2,
    contextWindow: 4096,
    maxOutputTokens: 1024,
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
  const data = chunks.map((c) => encoder.encode(c));
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < data.length) {
        controller.enqueue(data[i++]);
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

describe("ModelsDevProviderAdapter", () => {
  afterEach(() => vi.clearAllMocks());

  it("constructor sets name and models", () => {
    const a = new ModelsDevProviderAdapter({
      name: "test",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    expect(a.name).toBe("test");
    expect(a.listModels()).toEqual(testModels);
  });

  it("does not advertise passthrough endpoints without apiBase", () => {
    const a = new ModelsDevProviderAdapter({ name: "t", apiKey: "k", models: testModels });

    expect(a.capabilities.responsesApi).toBe(false);
    expect(a.capabilities.embeddingsApi).toBe(false);
    expect(a.capabilities.moderationsApi).toBe(false);
    expect(a.capabilities.imageGenerationsApi).toBe(false);
    expect(a.capabilities.completionsApi).toBe(false);
    expect(a.capabilities.audioTranscriptionsApi).toBe(false);
    expect(a.capabilities.audioTranslationsApi).toBe(false);
    expect(a.capabilities.audioSpeechApi).toBe(false);
  });

  it("chatCompletion throws without apiBase", async () => {
    const a = new ModelsDevProviderAdapter({ name: "t", apiKey: "k", models: testModels });
    await expect(a.chatCompletion({ model: "m1", messages: [] })).rejects.toThrow(
      "chat completions URL",
    );
  });

  it("chatCompletion sends POST and returns response", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        id: "r1",
        model: "m1",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    const resp = await a.chatCompletion({
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp.id).toBe("r1");
  });

  it("chatCompletion forwards advanced OpenAI-compatible fields", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        id: "r1",
        model: "m1",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    await a.chatCompletion({
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
      response_format: { type: "json_object" },
    });
    const requestBody = JSON.parse(String(mockGlobalFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.tools).toEqual([{ type: "function", function: { name: "lookup" } }]);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("chatCompletion throws on non-ok", async () => {
    mockGlobalFetch.mockResolvedValueOnce(new Response("err", { status: 429 }));
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    await expect(a.chatCompletion({ model: "m1", messages: [] })).rejects.toThrow("429");
  });

  it("createEmbedding throws without apiBase", async () => {
    const a = new ModelsDevProviderAdapter({ name: "t", apiKey: "k", models: testModels });
    await expect(a.createEmbedding({ model: "m1", input: "hello" })).rejects.toThrow(
      "embeddings URL",
    );
  });

  it("createEmbedding sends POST and returns response", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: "m1",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });
    const resp = await a.createEmbedding({
      model: "m1",
      input: ["hello"],
      encoding_format: "float",
    });

    expect(resp.data[0]?.embedding).toEqual([0.1]);
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
    const requestBody = JSON.parse(String(mockGlobalFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual({
      model: "m1",
      input: ["hello"],
      encoding_format: "float",
    });
  });

  it("createModeration sends POST to the derived moderations endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        id: "modr-1",
        model: "m1",
        results: [{ flagged: false }],
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });

    const resp = await a.createModeration({ model: "m1", input: "hello" });

    expect(resp.results).toEqual([{ flagged: false }]);
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/moderations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createImageGeneration sends POST to the derived image generations endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        created: 1,
        data: [{ b64_json: "abc" }],
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });

    const resp = await a.createImageGeneration({ model: "m1", prompt: "cat" });

    expect(resp.data?.[0]?.b64_json).toBe("abc");
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createCompletion sends POST to the derived completions endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      Response.json({
        id: "cmpl-1",
        model: "m1",
        choices: [{ text: "hi", index: 0 }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });

    const resp = await a.createCompletion({ model: "m1", prompt: "hello" });

    expect(resp.choices?.[0]?.text).toBe("hi");
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("createAudioTranscription sends multipart to the derived audio transcriptions endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(Response.json({ text: "hello" }));
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });
    const formData = new FormData();
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    formData.append("file", file);
    formData.append("model", "client-model");

    await a.createAudioTranscription({ model: "m1", formData });

    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer k" },
      }),
    );
    const requestBody = mockGlobalFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("model")).toBe("m1");
    expect(requestBody.get("file")).toBe(file);
  });

  it("createAudioSpeech sends JSON to the derived audio speech endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/mpeg" } }),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });

    const response = await a.createAudioSpeech({ model: "m1", input: "hello", voice: "alloy" });

    expect(response.contentType).toBe("audio/mpeg");
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
  });

  it("createCompletionStream yields raw SSE from the derived completions endpoint", async () => {
    mockGlobalFetch.mockResolvedValueOnce(makeSSEStream(['data: {"id":"c1"}\n\n']));
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com/v1/chat/completions",
      models: testModels,
    });

    const chunks: string[] = [];
    for await (const chunk of a.createCompletionStream({ model: "m1", prompt: "hello" })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe('data: {"id":"c1"}\n\n');
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      "https://x.com/v1/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockGlobalFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ model: "m1", prompt: "hello", stream: true });
  });

  it("chatCompletionStream throws without apiBase", async () => {
    const a = new ModelsDevProviderAdapter({ name: "t", apiKey: "k", models: testModels });
    await expect(async () => {
      const it = a.chatCompletionStream({ model: "m1", messages: [] });
      for await (const _ of it) {
        void _;
      }
    }).rejects.toThrow("chat completions URL");
  });

  it("chatCompletionStream yields chunks from SSE", async () => {
    mockGlobalFetch.mockResolvedValueOnce(
      makeSSEStream([
        'data: {"id":"c1","model":"m1","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    const chunks: unknown[] = [];
    for await (const chunk of a.chatCompletionStream({ model: "m1", messages: [] })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
  });

  it("chatCompletionStream requests usage for OpenAI-compatible providers", async () => {
    mockGlobalFetch.mockResolvedValueOnce(makeSSEStream(["data: [DONE]\n\n"]));
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    for await (const _ of a.chatCompletionStream({ model: "m1", messages: [] })) {
      void _;
    }
    const requestBody = JSON.parse(String(mockGlobalFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.stream_options).toEqual({ include_usage: true });
  });

  it("chatCompletionStream throws on non-ok", async () => {
    mockGlobalFetch.mockResolvedValueOnce(new Response("err", { status: 500 }));
    const a = new ModelsDevProviderAdapter({
      name: "t",
      apiKey: "k",
      apiBase: "https://x.com",
      models: testModels,
    });
    await expect(async () => {
      for await (const _ of a.chatCompletionStream({ model: "m1", messages: [] })) {
        void _;
      }
    }).rejects.toThrow("500");
  });

  it("listModels returns models", () => {
    const a = new ModelsDevProviderAdapter({ name: "t", apiKey: "k", models: testModels });
    expect(a.listModels()).toBe(testModels);
  });
});
