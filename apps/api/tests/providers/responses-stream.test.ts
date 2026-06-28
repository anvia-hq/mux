import { describe, expect, it } from "vitest";
import {
  decodeStreamEvents,
  findCompletedUsage,
  isTerminalEvent,
  SseBlockParser,
} from "../../src/providers/responses-stream";
import type { ResponseObject } from "../../src/providers/responses-types";

describe("SseBlockParser", () => {
  it("parses a single LF-terminated block with event and data", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push('event: response.completed\ndata: {"id":"r1"}\n\n');
    expect(blocks).toEqual([{ event: "response.completed", data: '{"id":"r1"}' }]);
  });

  it("parses a single CRLF-terminated block", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("event: foo\r\ndata: bar\r\n\r\n");
    expect(blocks).toEqual([{ event: "foo", data: "bar" }]);
  });

  it("parses multiple blocks from one chunk", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
    expect(blocks).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  it("joins multi-line data fields with a newline", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("data: line1\ndata: line2\n\n");
    expect(blocks).toEqual([{ data: "line1\nline2" }]);
  });

  it("drops blocks that have neither event nor data", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("\n\ndata: only\n\n");
    expect(blocks).toEqual([{ data: "only" }]);
  });

  it("holds a partial block across multiple pushes", () => {
    const parser = new SseBlockParser();
    expect(parser.push("event: slo")).toEqual([]);
    expect(parser.push("w\ndata: hello\n\n")).toEqual([{ event: "slow", data: "hello" }]);
  });

  it("picks the earliest terminator when both LF and CRLF candidates exist", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("data: a\n\ndata: b\r\n\r\n");
    expect(blocks).toEqual([{ data: "a" }, { data: "b" }]);
  });

  it("returns remaining partial block from end()", () => {
    const parser = new SseBlockParser();
    parser.push("event: e\ndata: tail");
    expect(parser.end()).toEqual([{ event: "e", data: "tail" }]);
  });

  it("returns no blocks from end() when buffer is empty", () => {
    const parser = new SseBlockParser();
    expect(parser.end()).toEqual([]);
  });

  it("ignores lines that are neither event: nor data:", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push(": comment\nevent: x\nid: 7\ndata: y\n\n");
    expect(blocks).toEqual([{ event: "x", data: "y" }]);
  });

  it("returns the empty-string data field verbatim", () => {
    const parser = new SseBlockParser();
    const blocks = parser.push("event: ping\ndata:\n\n");
    expect(blocks).toEqual([{ event: "ping", data: "" }]);
  });
});

async function* toAsyncIterable(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

const completedResponse: ResponseObject = {
  id: "resp_1",
  object: "response",
  created_at: 0,
  model: "gpt-4o",
  status: "completed",
  output: [],
  usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
};

describe("decodeStreamEvents", () => {
  it("decodes a response.created event from event/data lines", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `event: response.created\ndata: ${JSON.stringify({ response: completedResponse })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list).toEqual([{ type: "response.created", response: completedResponse }]);
  });

  it("decodes a response.in_progress event", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.in_progress", response: completedResponse })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list[0]?.type).toBe("response.in_progress");
  });

  it("decodes a response.output_item.added event", async () => {
    const item = { type: "output_text", text: "hi" };
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list[0]).toEqual({ type: "response.output_item.added", output_index: 0, item });
  });

  it("decodes a response.output_text.delta event", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "hi" })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list[0]).toEqual({
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "hi",
    });
  });

  it("decodes a response.completed event", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.completed", response: completedResponse })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list[0]).toEqual({ type: "response.completed", response: completedResponse });
  });

  it("decodes a response.error event with optional fields", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.error", code: "boom", message: "nope", param: "x" })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list[0]).toEqual({
      type: "response.error",
      code: "boom",
      message: "nope",
      param: "x",
    });
  });

  it("silently drops [DONE] sentinels and unknown events", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        "data: [DONE]\n\n",
        `data: ${JSON.stringify({ type: "response.weird" })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list).toEqual([]);
  });

  it("silently skips malformed JSON", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        "data: not-json\n\n",
        `data: ${JSON.stringify({ type: "response.completed", response: completedResponse })}\n\n`,
      ]),
    );
    const list = [];
    for await (const e of events) list.push(e);
    expect(list).toHaveLength(1);
    expect(list[0]?.type).toBe("response.completed");
  });

  it("returns no events for an empty stream", async () => {
    const events = decodeStreamEvents(toAsyncIterable([]));
    const list = [];
    for await (const e of events) list.push(e);
    expect(list).toEqual([]);
  });

  it("isTerminalEvent marks only completed and error as terminal", () => {
    expect(isTerminalEvent({ type: "response.completed", response: completedResponse })).toBe(true);
    expect(isTerminalEvent({ type: "response.error", message: "x" })).toBe(true);
    expect(isTerminalEvent({ type: "response.created", response: completedResponse })).toBe(false);
    expect(
      isTerminalEvent({
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "x",
      }),
    ).toBe(false);
  });

  it("findCompletedUsage returns the first completed usage", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.created", response: { ...completedResponse, usage: undefined } })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: completedResponse })}\n\n`,
      ]),
    );
    const usage = await findCompletedUsage(events);
    expect(usage).toEqual({ input_tokens: 2, output_tokens: 3, total_tokens: 5 });
  });

  it("findCompletedUsage returns undefined when no completed event arrives", async () => {
    const events = decodeStreamEvents(
      toAsyncIterable([
        `data: ${JSON.stringify({ type: "response.created", response: completedResponse })}\n\n`,
      ]),
    );
    const usage = await findCompletedUsage(events);
    expect(usage).toBeUndefined();
  });
});
