import { describe, expect, it } from "vitest";
import {
  chatResponseToResponse,
  chatStreamToResponses,
  responseRequestToChat,
  UnsupportedResponseConversionError,
} from "../../src/providers/response-chat-converter";
import type { ChatCompletionChunk, ChatCompletionResponse } from "../../src/providers/types";

function streamOf(...chunks: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

async function readEvents(stream: AsyncIterable<string>) {
  const events: Array<Record<string, unknown>> = [];
  for await (const chunk of stream) {
    const data = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    if (data) events.push(JSON.parse(data) as Record<string, unknown>);
  }
  return events;
}

describe("Responses to chat conversion", () => {
  it("maps messages, multimodal input, functions, structured output, and generation settings", () => {
    const result = responseRequestToChat({
      model: "custom:model",
      instructions: "Be concise",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect this" },
            { type: "input_image", image_url: "https://example.test/image.png", detail: "low" },
          ],
        },
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
        { type: "function_call_output", call_id: "call_1", output: { found: true } },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Look something up",
          parameters: { type: "object", properties: { q: { type: "string" } } },
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: "lookup" },
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          schema: { type: "object", properties: { found: { type: "boolean" } } },
          strict: true,
        },
      },
      stream: true,
      stream_options: { include_usage: true },
      max_output_tokens: 256,
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      safety_identifier: "tenant-1",
      prompt_cache_key: "cache-1",
    });

    expect(result).toMatchObject({
      model: "custom:model",
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 256,
      parallel_tool_calls: false,
      reasoning_effort: "high",
      safety_identifier: "tenant-1",
      prompt_cache_key: "cache-1",
      tool_choice: { type: "function", function: { name: "lookup" } },
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", strict: true },
      },
    });
    expect(result.messages).toEqual([
      { role: "system", content: "Be concise" },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this" },
          {
            type: "image_url",
            image_url: { url: "https://example.test/image.png", detail: "low" },
          },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: '{"q":"x"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"found":true}' },
    ]);
    expect(result.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "lookup", strict: true },
    });
  });

  it.each([
    "conversation",
    "previous_response_id",
    "prompt",
    "context_management",
  ])("rejects the stateful %s field", (field) => {
    expect(() =>
      responseRequestToChat({ model: "custom:model", input: "hi", [field]: "present" }),
    ).toThrow(UnsupportedResponseConversionError);
  });

  it("rejects request shapes that cannot be represented safely in chat", () => {
    expect(() => responseRequestToChat({ model: "custom:model", input: { text: "hi" } })).toThrow(
      "input",
    );
    expect(() =>
      responseRequestToChat({
        model: "custom:model",
        input: "hi",
        tools: [{ type: "web_search_preview" }],
      }),
    ).toThrow("tools.web_search_preview");
    expect(() =>
      responseRequestToChat({
        model: "custom:model",
        input: "hi",
        tool_choice: { type: "file_search" },
      }),
    ).toThrow("tool_choice");
    expect(() =>
      responseRequestToChat({
        model: "custom:model",
        input: [{ type: "computer_call", id: "call_1" }],
      }),
    ).toThrow("input.computer_call");
    expect(() =>
      responseRequestToChat({
        model: "custom:model",
        input: [
          {
            role: "user",
            content: [{ type: "computer_screenshot", image_url: "x" }],
          },
        ],
      }),
    ).toThrow("input.content.computer_screenshot");
    expect(() =>
      responseRequestToChat({
        model: "custom:model",
        input: [{ type: "custom_tool_call", call_id: "call_1", name: "shell" }],
      }),
    ).toThrow("input.custom_tool_call");
  });

  it("filters custom calls and custom tools for Google-compatible chat", () => {
    const result = responseRequestToChat(
      {
        model: "google:gemini",
        input: [
          { role: "user", content: "hi" },
          { type: "custom_tool_call", call_id: "call_custom", name: "shell", input: "pwd" },
          { type: "custom_tool_call_output", call_id: "call_custom", output: "/tmp" },
        ],
        tools: [{ type: "custom", name: "shell" }],
      },
      { googleCompatible: true },
    );

    expect(result.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.tools).toBeUndefined();
  });
});

describe("Chat to Responses conversion", () => {
  it("maps incomplete responses, tool calls, and usage", () => {
    const chat: ChatCompletionResponse = {
      id: "chatcmpl_1",
      model: "upstream-model",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: {
            role: "assistant",
            content: "partial",
            reasoning_content: "thinking",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"q":"x"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };

    const response = chatResponseToResponse(chat, "alias:model");
    expect(response).toMatchObject({
      id: "resp_chatcmpl_1",
      object: "response",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      model: "alias:model",
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    });
    expect(response.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", status: "incomplete" }),
        expect.objectContaining({ type: "reasoning", status: "incomplete" }),
        expect.objectContaining({ type: "function_call", call_id: "call_1" }),
      ]),
    );
  });

  it("preserves output indexes and final output order when tools arrive before text", async () => {
    const events = await readEvents(
      chatStreamToResponses(
        streamOf(
          {
            id: "chatcmpl_1",
            model: "upstream-model",
            choices: [
              {
                index: 0,
                finish_reason: null,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "lookup", arguments: '{"q":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "chatcmpl_1",
            model: "upstream-model",
            choices: [
              {
                index: 0,
                finish_reason: null,
                delta: {
                  reasoning_content: "think",
                  content: "hello",
                  tool_calls: [{ index: 0, function: { arguments: '"x"}' } }],
                },
              },
            ],
          },
          {
            id: "chatcmpl_1",
            model: "upstream-model",
            choices: [{ index: 0, finish_reason: "tool_calls", delta: {} }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          },
        ),
        "alias:model",
      ),
    );

    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index));
    expect(
      events.find((event) => event.type === "response.function_call_arguments.delta"),
    ).toMatchObject({
      output_index: 0,
    });
    expect(
      events.find((event) => event.type === "response.reasoning_summary_text.delta"),
    ).toMatchObject({
      output_index: 1,
    });
    expect(events.find((event) => event.type === "response.output_text.delta")).toMatchObject({
      output_index: 2,
    });
    const completed = events.at(-1) as {
      type: string;
      response: { output: Array<{ type: string }> };
    };
    expect(completed.type).toBe("response.completed");
    expect(completed.response.output.map((item) => item.type)).toEqual([
      "function_call",
      "reasoning",
      "message",
    ]);
  });

  it("keeps a generated tool-call id stable when a later chat delta supplies an id", async () => {
    const events = await readEvents(
      chatStreamToResponses(
        streamOf(
          {
            id: "chatcmpl_1",
            model: "upstream-model",
            choices: [
              {
                index: 0,
                finish_reason: null,
                delta: {
                  tool_calls: [
                    { index: 0, type: "function", function: { name: "lookup", arguments: "" } },
                  ],
                },
              },
            ],
          },
          {
            id: "chatcmpl_1",
            model: "upstream-model",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                delta: {
                  tool_calls: [{ index: 0, id: "late_call_id", function: { arguments: "{}" } }],
                },
              },
            ],
          },
        ),
        "alias:model",
      ),
    );

    const added = events.find((event) => event.type === "response.output_item.added") as {
      item: { id: string };
    };
    const argumentDelta = events.find(
      (event) => event.type === "response.function_call_arguments.delta",
    ) as { item_id: string };
    const completed = events.at(-1) as { response: { output: Array<{ id: string }> } };

    expect(argumentDelta.item_id).toBe(added.item.id);
    expect(completed.response.output[0]?.id).toBe(added.item.id);
  });

  it("closes the upstream chat iterator when the converted stream is cancelled", async () => {
    let closed = false;
    async function* source(): AsyncIterable<ChatCompletionChunk> {
      try {
        yield {
          id: "chatcmpl_1",
          model: "upstream-model",
          choices: [{ index: 0, finish_reason: null, delta: { content: "hello" } }],
        };
        await new Promise(() => undefined);
      } finally {
        closed = true;
      }
    }

    const iterator = chatStreamToResponses(source(), "alias:model")[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();

    expect(closed).toBe(true);
  });
});
