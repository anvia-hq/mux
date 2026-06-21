import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("../models-dev-provider-adapter", () => ({
  ModelsDevProviderAdapter: class {
    name: string;
    constructor(input: { name: string }) { this.name = input.name; }
    listModels() { return []; }
  },
}));

import { AnthropicAdapter } from "./anthropic";

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

  it("maps streaming usage events into OpenAI-style usage", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSSEStream([
        'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":7,"output_tokens":1}}}\n\n',
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
  });
});
