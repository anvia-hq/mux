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

import { MistralAdapter } from "../../src/providers/mistral";

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

describe("MistralAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates adapter with name mistral", () => {
    const adapter = new MistralAdapter("sk-test");
    expect(adapter.name).toBe("mistral");
  });

  it("merges request override headers after Mistral defaults", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chatcmpl-1",
        model: "mistral-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const adapter = new MistralAdapter("sk-test");
    await adapter.chatCompletion(
      {
        model: "mistral-test",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        headers: {
          authorization: "Bearer channel-key",
          "x-trace": "trace-123",
        },
      },
    );

    expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      authorization: "Bearer channel-key",
      "x-trace": "trace-123",
    });
    expect(mockFetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("requests usage in streaming chat completions", async () => {
    mockFetch.mockResolvedValueOnce(makeSSEStream(["data: [DONE]\n\n"]));

    const adapter = new MistralAdapter("sk-test");
    for await (const _chunk of adapter.chatCompletionStream({
      model: "mistral-test",
      messages: [{ role: "user", content: "hi" }],
    })) {
      // Drain stream.
    }

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "mistral-test",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("normalizes tool call IDs consistently across assistant calls and results", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chatcmpl-1",
        model: "mistral-test",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "done" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const request = {
      model: "mistral-test",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_needs_rewriting",
              type: "function" as const,
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_needs_rewriting", content: "ok" },
      ],
    };

    await new MistralAdapter("sk-test").chatCompletion(request);

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    const toolCallId = requestBody.messages[0].tool_calls[0].id;
    expect(toolCallId).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(requestBody.messages[1].tool_call_id).toBe(toolCallId);
    expect(request.messages[0]?.tool_calls?.[0]?.id).toBe("call_needs_rewriting");
  });

  it("accepts tool-call-only responses with nullable content", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        id: "chatcmpl-1",
        model: "mistral-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "Abc123xyz",
                  type: "function",
                  function: { name: "lookup", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const response = await new MistralAdapter("sk-test").chatCompletion({
      model: "mistral-test",
      messages: [{ role: "user", content: "lookup" }],
    });

    expect(response.choices[0]?.message.content).toBeNull();
    expect(response.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("lookup");
  });
});
