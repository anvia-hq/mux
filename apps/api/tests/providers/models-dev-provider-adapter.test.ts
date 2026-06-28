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
