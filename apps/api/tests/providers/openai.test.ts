import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("../../src/models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) {
      this.name = input.name;
    }
    listModels() {
      return [];
    }
  },
}));

import { OpenAIAdapter, UpstreamResponsesApiError } from "../../src/providers/openai";

vi.stubGlobal("fetch", mockFetch);

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

function makeBinaryStream(chunks: Uint8Array[]) {
  let index = 0;

  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
          return;
        }

        controller.close();
      },
    }),
    { headers: { "Content-Type": "audio/mpeg" } },
  );
}

describe("OpenAIAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates adapter with name openai", () => {
    const adapter = new OpenAIAdapter("sk-test");
    expect(adapter.name).toBe("openai");
  });

  it("requests usage in streaming chat completions", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'data: {"id":"chunk-1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
        'data: {"id":"chunk-2","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const chunks = [];
    for await (const chunk of adapter.chatCompletionStream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-4o",
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    });
  });

  it("forwards advanced chat completion fields", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chat-1",
        model: "gpt-4o",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.chatCompletion({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: { type: "object" } },
      },
      top_p: 0.9,
      stop: ["END"],
      seed: 1,
      max_completion_tokens: 64,
      logprobs: true,
      top_logprobs: 2,
      reasoning_effort: "low",
      metadata: { trace: "t1" },
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      tools: [{ type: "function", function: { name: "lookup" } }],
      tool_choice: "auto",
      response_format: { type: "json_schema" },
      top_p: 0.9,
      stop: ["END"],
      seed: 1,
      max_completion_tokens: 64,
      logprobs: true,
      top_logprobs: 2,
      reasoning_effort: "low",
      metadata: { trace: "t1" },
    });
  });

  it("merges provider request headers case-insensitively", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chat-1",
        model: "gpt-4o",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.chatCompletion(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        headers: {
          authorization: "Bearer override",
          "X-Trace": "trace-123",
        },
      },
    );

    expect(mockFetch.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      authorization: "Bearer override",
      "X-Trace": "trace-123",
    });
  });

  it("uses raw body when provided for chat completions", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chat-1",
        model: "gpt-4o",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const rawBody = '{\n  "model": "gpt-4o",\n  "messages": []\n}';
    const adapter = new OpenAIAdapter("sk-test");
    await adapter.chatCompletion(
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      },
      { rawBody },
    );

    expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(rawBody);
  });

  it("creates embeddings through the OpenAI Embeddings API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createEmbedding({
      model: "text-embedding-3-small",
      input: "hello",
      encoding_format: "float",
      dimensions: 256,
      user: "user-1",
    });

    expect(response.data[0]?.embedding).toEqual([0.1, 0.2]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual({
      model: "text-embedding-3-small",
      input: "hello",
      encoding_format: "float",
      dimensions: 256,
      user: "user-1",
    });
  });

  it("creates moderations through the OpenAI Moderations API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "modr-1",
        model: "omni-moderation-latest",
        results: [{ flagged: false }],
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createModeration({
      model: "omni-moderation-latest",
      input: "hello",
    });

    expect(response.results).toEqual([{ flagged: false }]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual({
      model: "omni-moderation-latest",
      input: "hello",
    });
  });

  it("creates image generations through the OpenAI Images API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        created: 1,
        data: [{ url: "https://example.test/image.png", revised_prompt: "A small cat" }],
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createImageGeneration({
      model: "gpt-image-1",
      prompt: "cat",
      size: "1024x1024",
      response_format: "url",
    });

    expect(response.data?.[0]?.url).toBe("https://example.test/image.png");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-image-1",
      prompt: "cat",
      size: "1024x1024",
      response_format: "url",
    });
  });

  it("streams raw image generation SSE from the OpenAI Images API", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'event: image_generation.partial_image\ndata: {"partial_image_index":0}\n\n',
        'event: image_generation.completed\ndata: {"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n',
      ]),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const chunks: string[] = [];
    for await (const chunk of adapter.createImageGenerationStream({
      model: "gpt-image-1",
      prompt: "cat",
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(
      'event: image_generation.partial_image\ndata: {"partial_image_index":0}\n\n' +
        'event: image_generation.completed\ndata: {"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ model: "gpt-image-1", prompt: "cat", stream: true });
  });

  it("wraps non-stream image generation responses as OpenAI image SSE", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        created: 1,
        data: [{ b64_json: "abc" }],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const chunks: string[] = [];
    for await (const chunk of adapter.createImageGenerationStream({
      model: "gpt-image-1",
      prompt: "cat",
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(
      'event: image_generation.completed\ndata: {"created":1,"data":[{"b64_json":"abc"}],"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n' +
        "data: [DONE]\n\n",
    );
  });

  it("creates legacy completions through the OpenAI Completions API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "cmpl-1",
        model: "gpt-3.5-turbo-instruct",
        choices: [{ text: "hello", index: 0, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createCompletion({
      model: "gpt-3.5-turbo-instruct",
      prompt: "Say hello",
      max_tokens: 8,
      echo: false,
    });

    expect(response.choices?.[0]?.text).toBe("hello");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-3.5-turbo-instruct",
      prompt: "Say hello",
      max_tokens: 8,
      echo: false,
    });
  });

  it("streams raw legacy completion SSE from the OpenAI Completions API", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'data: {"id":"cmpl-1","model":"gpt-3.5-turbo-instruct","choices":[{"text":"hi","index":0}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const chunks: string[] = [];
    for await (const chunk of adapter.createCompletionStream({
      model: "gpt-3.5-turbo-instruct",
      prompt: "Say hi",
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(
      'data: {"id":"cmpl-1","model":"gpt-3.5-turbo-instruct","choices":[{"text":"hi","index":0}]}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-3.5-turbo-instruct",
      prompt: "Say hi",
      stream: true,
    });
  });

  it("creates audio transcriptions through the OpenAI Audio API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ text: "hello" }, { headers: { "Content-Type": "application/json" } }),
    );

    const formData = new FormData();
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    formData.append("model", "client-model");
    formData.append("file", file);
    formData.append("temperature", "0.2");

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createAudioTranscription({
      model: "whisper-1",
      formData,
    });

    expect(new TextDecoder().decode(response.body)).toBe('{"text":"hello"}');
    expect(response.contentType).toContain("application/json");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
      }),
    );

    const requestBody = mockFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("model")).toBe("whisper-1");
    expect(requestBody.get("file")).toBe(file);
    expect(requestBody.get("temperature")).toBe("0.2");
  });

  it("streams audio transcriptions through the OpenAI Audio API", async () => {
    mockFetch.mockResolvedValueOnce(makeSSEStream(["data: hello\n\n"]));

    const formData = new FormData();
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    formData.append("model", "client-model");
    formData.append("file", file);

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createAudioTranscriptionStream({
      model: "gpt-4o-transcribe",
      formData,
    });
    const chunks: string[] = [];
    for await (const chunk of response.stream) {
      expect(typeof chunk).toBe("string");
      chunks.push(String(chunk));
    }

    expect(response.contentType).toBe("text/event-stream");
    expect(chunks.join("")).toBe("data: hello\n\n");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
      }),
    );

    const requestBody = mockFetch.mock.calls[0]?.[1]?.body as FormData;
    expect(requestBody.get("model")).toBe("gpt-4o-transcribe");
    expect(requestBody.get("file")).toBe(file);
  });

  it("creates audio speech and returns upstream audio bytes", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createAudioSpeech({
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      response_format: "mp3",
    });

    expect(response.contentType).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(response.body))).toEqual([1, 2, 3]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      response_format: "mp3",
    });
  });

  it("streams audio speech through the OpenAI Audio API", async () => {
    mockFetch.mockResolvedValueOnce(makeSSEStream(["data: speech\n\n"]));

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createAudioSpeechStream({
      model: "gpt-4o-mini-tts",
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
      "https://api.openai.com/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini-tts",
      input: "hello",
      voice: "alloy",
      stream_format: "sse",
    });
  });

  it("streams raw audio bytes through the OpenAI Audio API", async () => {
    mockFetch.mockResolvedValueOnce(
      makeBinaryStream([new Uint8Array([1, 2]), new Uint8Array([3])]),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createAudioSpeechStream({
      model: "gpt-4o-mini-tts",
      input: "hello",
      voice: "alloy",
      stream_format: "audio",
    });
    const bytes: number[] = [];
    for await (const chunk of response.stream) {
      expect(chunk).toBeInstanceOf(Uint8Array);
      bytes.push(...(chunk as Uint8Array));
    }

    expect(response.contentType).toBe("audio/mpeg");
    expect(bytes).toEqual([1, 2, 3]);
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini-tts",
      input: "hello",
      voice: "alloy",
      stream_format: "audio",
    });
  });

  it("creates responses through the OpenAI Responses API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp-1",
        object: "response",
        model: "gpt-4o",
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.createResponse({
      model: "gpt-4o",
      input: "hi",
      instructions: "Be brief",
      text: { format: { type: "text" } },
      reasoning: { effort: "low" },
    });

    expect(response.id).toBe("resp-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-4o",
      input: "hi",
      instructions: "Be brief",
      text: { format: { type: "text" } },
      reasoning: { effort: "low" },
    });
  });

  it("uses raw body when provided for Responses create", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp-1", model: "gpt-4o" }));

    const rawBody = '{\n  "model": "gpt-4o",\n  "input": "hi"\n}';
    const adapter = new OpenAIAdapter("sk-test");
    await adapter.createResponse({ model: "gpt-4o", input: "ignored" }, { rawBody });

    expect(mockFetch.mock.calls[0]?.[1]?.body).toBe(rawBody);
  });

  it("forwards stream_options.include_obfuscation to the upstream POST body", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp-1",
        object: "response",
        model: "gpt-4o",
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.createResponse({
      model: "gpt-4o",
      input: "hi",
      stream: true,
      stream_options: { include_obfuscation: true },
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-4o",
      input: "hi",
      stream: true,
      stream_options: { include_obfuscation: true },
    });
  });

  it("streams raw responses from the OpenAI Responses API", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n',
      ]),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const chunks: string[] = [];
    for await (const chunk of adapter.createResponseStream({
      model: "gpt-4o",
      input: "hi",
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ model: "gpt-4o", input: "hi", stream: true });
  });

  it("retrieves a response by id", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp_abc",
        object: "response",
        status: "completed",
        model: "gpt-4o-2024-08-06",
        output: [],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.getResponse("resp_abc");

    expect(response).toMatchObject({ id: "resp_abc", model: "gpt-4o-2024-08-06" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_abc",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("propagates upstream errors from getResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await expect(adapter.getResponse("resp_missing")).rejects.toThrow(
      "OpenAI Responses API error: 404",
    );
  });

  it("encodes response ids in the retrieval URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp/x y", object: "response" }));

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.getResponse("resp/x y");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp%2Fx%20y",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws UpstreamResponsesApiError with status and body on getResponse failures", async () => {
    const errorBody = JSON.stringify({
      error: { message: "not found", type: "not_found", param: null, code: null },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(errorBody, { status: 404, headers: { "Content-Type": "application/json" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    let caught: unknown;
    try {
      await adapter.getResponse("resp_missing");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UpstreamResponsesApiError);
    expect((caught as UpstreamResponsesApiError).status).toBe(404);
    expect((caught as UpstreamResponsesApiError).jsonError).toMatchObject({
      message: "not found",
      type: "not_found",
    });
  });

  it("forwards repeated query params to the upstream GET URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp_abc", object: "response" }));

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.getResponse("resp_abc", {
      include: ["file_search_call.results", "message.input_image"],
      include_obfuscation: "true",
    });

    const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("include=file_search_call.results");
    expect(calledUrl).toContain("include=message.input_image");
    expect(calledUrl).toContain("include_obfuscation=true");
  });

  it("deletes a response via the OpenAI Responses API", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: "resp_abc", object: "response", deleted: true }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.deleteResponse("resp_abc");

    expect(response).toMatchObject({ id: "resp_abc", deleted: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_abc",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("throws UpstreamResponsesApiError when deleteResponse fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await expect(adapter.deleteResponse("resp_missing")).rejects.toBeInstanceOf(
      UpstreamResponsesApiError,
    );
  });

  it("cancels a response and returns the upstream body", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp_abc",
        object: "response",
        status: "cancelled",
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const response = await adapter.cancelResponse("resp_abc");

    expect(response).toMatchObject({ id: "resp_abc", status: "cancelled" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_abc/cancel",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );
  });

  it("encodes the response id in the cancel URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ id: "resp/x y", status: "cancelled" }));

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.cancelResponse("resp/x y");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp%2Fx%20y/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("propagates upstream errors from cancelResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await expect(adapter.cancelResponse("resp_missing")).rejects.toBeInstanceOf(
      UpstreamResponsesApiError,
    );
  });

  it("compacts a response and returns the upstream body", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "resp_001",
        object: "response.compaction",
        output: [{ id: "cmp_001", type: "compaction", encrypted_content: "gAAAAA..." }],
        usage: { input_tokens: 139, output_tokens: 438, total_tokens: 577 },
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const result = await adapter.compactResponse({
      model: "gpt-5.1-codex-max",
      input: [{ role: "user", content: "hello" }],
    });

    expect(result).toMatchObject({
      id: "resp_001",
      object: "response.compaction",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/compact",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );
  });

  it("serializes the compact body as JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: "resp_001", object: "response.compaction" }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.compactResponse({ model: "gpt-5", input: "hello" });

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ model: "gpt-5", input: "hello" });
  });

  it("propagates upstream errors from compactResponse", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await expect(adapter.compactResponse({ model: "gpt-5" })).rejects.toBeInstanceOf(
      UpstreamResponsesApiError,
    );
  });

  it("counts input tokens for a request without creating a response", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ object: "response.input_tokens", input_tokens: 42 }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const result = await adapter.countResponseInputTokens({
      model: "gpt-4o",
      input: "Tell me a story",
      instructions: "Be brief",
    });

    expect(result).toMatchObject({ object: "response.input_tokens", input_tokens: 42 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/input_tokens",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
      }),
    );
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual({
      model: "gpt-4o",
      input: "Tell me a story",
      instructions: "Be brief",
    });
  });

  it("propagates upstream 404 from countResponseInputTokens", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    let caught: unknown;
    try {
      await adapter.countResponseInputTokens({ model: "gpt-4o", input: "hi" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UpstreamResponsesApiError);
    expect((caught as UpstreamResponsesApiError).status).toBe(404);
  });

  it("propagates upstream 500 from countResponseInputTokens", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("boom", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    await expect(
      adapter.countResponseInputTokens({ model: "gpt-4o", input: "hi" }),
    ).rejects.toBeInstanceOf(UpstreamResponsesApiError);
  });

  it("lists input items for a response", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [
          {
            id: "msg_abc",
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Tell me a story." }],
          },
        ],
        first_id: "msg_abc",
        last_id: "msg_abc",
        has_more: false,
      }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    const result = await adapter.listResponseInputItems("resp_abc");

    expect(result).toMatchObject({
      object: "list",
      data: [{ id: "msg_abc", role: "user" }],
      has_more: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_abc/input_items",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("encodes the response id in the input_items URL", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ object: "list", data: [] }));

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.listResponseInputItems("resp/x y");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp%2Fx%20y/input_items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("forwards query params verbatim to input_items", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ object: "list", data: [] }));

    const adapter = new OpenAIAdapter("sk-test");
    await adapter.listResponseInputItems("resp_abc", {
      after: "msg_xyz",
      include: ["file_search_call.results", "message.input_image.image_url"],
      limit: "20",
      order: "desc",
    });

    const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/v1/responses/resp_abc/input_items");
    expect(calledUrl).toContain("after=msg_xyz");
    expect(calledUrl).toContain("include=file_search_call.results");
    expect(calledUrl).toContain("include=message.input_image.image_url");
    expect(calledUrl).toContain("limit=20");
    expect(calledUrl).toContain("order=desc");
  });

  it("throws UpstreamResponsesApiError when listResponseInputItems fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
    );

    const adapter = new OpenAIAdapter("sk-test");
    let caught: unknown;
    try {
      await adapter.listResponseInputItems("resp_missing");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UpstreamResponsesApiError);
    expect((caught as UpstreamResponsesApiError).status).toBe(404);
  });
});
