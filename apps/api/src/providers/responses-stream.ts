/**
 * Server-Sent Events (SSE) block parser and typed event decoder for the
 * OpenAI Responses stream.
 *
 * `SseBlockParser` buffers raw text chunks and yields parsed blocks
 * (`{ event?, data }`). `decodeStreamEvents` wraps the parser around an
 * async iterable of raw strings and yields typed `ResponseStreamEvent`s.
 *
 * Phase 0 ships the six event types the gateway currently exercises.
 * Later plan items (P9.1–P9.3) extend the union.
 */

import type { ResponseObject, ResponseOutputItem, ResponseUsage } from "./responses-types";

export type SseBlock = {
  event?: string;
  data: string;
};

export type ResponseStreamEvent =
  | { type: "response.created"; response: ResponseObject }
  | { type: "response.in_progress"; response: ResponseObject }
  | { type: "response.output_item.added"; output_index: number; item: ResponseOutputItem }
  | {
      type: "response.output_text.delta";
      output_index: number;
      content_index: number;
      delta: string;
    }
  | { type: "response.completed"; response: ResponseObject }
  | { type: "response.error"; code?: string | null; message: string; param?: string | null };

export const TERMINAL_EVENT_TYPES: ReadonlySet<ResponseStreamEvent["type"]> = new Set([
  "response.completed",
  "response.error",
]);

export function isTerminalEvent(event: ResponseStreamEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

export async function findCompletedUsage(
  stream: AsyncIterable<ResponseStreamEvent>,
): Promise<ResponseUsage | undefined> {
  for await (const event of stream) {
    if (event.type === "response.completed") {
      return event.response.usage;
    }
  }
  return undefined;
}

export async function* decodeStreamEvents(
  stream: AsyncIterable<string>,
): AsyncGenerator<ResponseStreamEvent> {
  const parser = new SseBlockParser();
  for await (const chunk of stream) {
    for (const block of parser.push(chunk)) {
      const event = parseResponseStreamBlock(block);
      if (event) yield event;
    }
  }
  for (const block of parser.end()) {
    const event = parseResponseStreamBlock(block);
    if (event) yield event;
  }
}

export function parseResponseStreamBlock(block: SseBlock): ResponseStreamEvent | null {
  const data = block.data;
  if (!data || data === "[DONE]") return null;

  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const typeFromEvent = block.event;
  const typeFromPayload = typeof payload.type === "string" ? payload.type : undefined;
  const type = typeFromEvent ?? typeFromPayload;
  if (!type) return null;

  switch (type) {
    case "response.created":
    case "response.in_progress":
    case "response.completed": {
      const response = payload.response as ResponseObject | undefined;
      if (!response) return null;
      return { type, response };
    }
    case "response.output_item.added": {
      if (
        typeof payload.output_index !== "number" ||
        !payload.item ||
        typeof payload.item !== "object"
      ) {
        return null;
      }
      return {
        type,
        output_index: payload.output_index,
        item: payload.item as ResponseOutputItem,
      };
    }
    case "response.output_text.delta": {
      if (
        typeof payload.output_index !== "number" ||
        typeof payload.content_index !== "number" ||
        typeof payload.delta !== "string"
      ) {
        return null;
      }
      return {
        type,
        output_index: payload.output_index,
        content_index: payload.content_index,
        delta: payload.delta,
      };
    }
    case "response.error": {
      const message = typeof payload.message === "string" ? payload.message : "Unknown error";
      return {
        type,
        code: (payload.code as string | null | undefined) ?? null,
        message,
        param: (payload.param as string | null | undefined) ?? null,
      };
    }
    default:
      return null;
  }
}

export class SseBlockParser {
  private buffer = "";

  push(chunk: string): SseBlock[] {
    this.buffer += chunk;
    const blocks: SseBlock[] = [];

    while (true) {
      const next = this.peekNextBlock();
      if (next === null) break;
      const { delimiterLength, block } = next;
      this.buffer = this.buffer.slice(delimiterLength);
      const parsed = parseSseBlock(block);
      if (parsed) blocks.push(parsed);
    }

    return blocks;
  }

  end(): SseBlock[] {
    if (this.buffer.length === 0) return [];
    const parsed = parseSseBlock(this.buffer);
    this.buffer = "";
    return parsed ? [parsed] : [];
  }

  private peekNextBlock(): { delimiterLength: number; block: string } | null {
    const lfIndex = this.buffer.indexOf("\n\n");
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    const candidates: { index: number; length: number }[] = [];
    if (lfIndex >= 0) candidates.push({ index: lfIndex, length: 2 });
    if (crlfIndex >= 0) candidates.push({ index: crlfIndex, length: 4 });
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.index - b.index);
    const winner = candidates[0];
    if (!winner) return null;
    return {
      delimiterLength: winner.index + winner.length,
      block: this.buffer.slice(0, winner.index),
    };
  }
}

function parseSseBlock(block: string): SseBlock | null {
  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      const value = line.slice("event:".length).trim();
      if (value) event = value;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n");
  if (data.length === 0 && event === undefined) return null;
  return event === undefined ? { data } : { event, data };
}
