import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("../models-dev-provider-adapter", () => ({
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

import { OpenAIAdapter, UpstreamResponsesApiError } from "./openai";

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
});
