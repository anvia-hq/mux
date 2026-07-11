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

import { AnthropicAdapter, UpstreamAnthropicMessagesApiError } from "../../src/providers/anthropic";

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

describe("AnthropicAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates adapter with name anthropic", () => {
    const adapter = new AnthropicAdapter("sk-test");
    expect(adapter.name).toBe("anthropic");
  });

  it("merges request override headers after Anthropic defaults", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "msg-1",
        model: "claude-test",
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const adapter = new AnthropicAdapter("sk-test");
    await adapter.chatCompletion(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        headers: {
          "x-api-key": "sk-channel",
          "x-trace": "trace-123",
        },
      },
    );

    expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "sk-channel",
      "x-trace": "trace-123",
    });
  });

  it("maps streaming usage events into OpenAI-style usage", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":7,"output_tokens":1,"cache_creation_input_tokens":5,"cache_read_input_tokens":6}}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    );

    const adapter = new AnthropicAdapter("sk-test");
    const chunks = [];
    for await (const chunk of adapter.chatCompletionStream({
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    });
    expect(chunks.at(-1)?.usage?.pricing_input_tokens).toBe(18);
    expect(JSON.stringify(chunks.at(-1)?.usage)).not.toContain("pricing_input_tokens");
  });

  it("translates tools and tool results to Anthropic format", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "msg-1",
        model: "claude-test",
        content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "hi" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 6 },
      }),
    );

    const adapter = new AnthropicAdapter("sk-test");
    const response = await adapter.chatCompletion({
      model: "claude-test",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"hi"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      tool_choice: { type: "function", function: { name: "lookup" } },
      max_completion_tokens: 123,
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.max_tokens).toBe(123);
    expect(requestBody.tools).toEqual([{ name: "lookup", input_schema: { type: "object" } }]);
    expect(requestBody.tool_choice).toEqual({ type: "tool", name: "lookup" });
    expect(requestBody.messages[1].content[0]).toMatchObject({ type: "tool_use", name: "lookup" });
    expect(requestBody.messages[2].content[0]).toMatchObject({ type: "tool_result" });
    expect(response.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      id: "toolu_1",
      function: { name: "lookup", arguments: '{"q":"hi"}' },
    });
    expect(response.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("proxies native Anthropic Messages requests without OpenAI conversion", async () => {
    const upstream = {
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 2, output_tokens: 3 },
    };
    mockFetch.mockResolvedValueOnce(Response.json(upstream));

    const adapter = new AnthropicAdapter("sk-upstream");
    const response = await adapter.createAnthropicMessage(
      {
        model: "claude-test",
        max_tokens: 99,
        messages: [{ role: "user", content: "hello" }],
      },
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2024-04-04",
        },
      },
    );

    expect(response).toEqual(upstream);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-upstream",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2024-04-04",
        }),
      }),
    );
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
      model: "claude-test",
      max_tokens: 99,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("streams native Anthropic Messages SSE without parsing", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );

    const adapter = new AnthropicAdapter("sk-test");
    const chunks = [];
    for await (const chunk of adapter.createAnthropicMessageStream({
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe(
      'event: message_start\ndata: {"type":"message_start"}\n\n' +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "claude-test",
      stream: true,
    });
  });

  it("proxies native Anthropic Messages token counting", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ input_tokens: 42 }));

    const adapter = new AnthropicAdapter("sk-upstream");
    const response = await adapter.countAnthropicMessageTokens(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hello" }],
      },
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2024-04-04",
        },
      },
    );

    expect(response).toEqual({ input_tokens: 42 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages/count_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-upstream",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2024-04-04",
        }),
      }),
    );
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
      model: "claude-test",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("preserves native Anthropic Messages upstream errors", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"type":"error","error":{"message":"bad"}}', {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const adapter = new AnthropicAdapter("sk-test");
    await expect(
      adapter.createAnthropicMessage({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      name: "UpstreamAnthropicMessagesApiError",
      status: 400,
      body: '{"type":"error","error":{"message":"bad"}}',
    } satisfies Partial<UpstreamAnthropicMessagesApiError>);
  });
});
