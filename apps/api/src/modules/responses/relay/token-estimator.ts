import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { ResponseCreateRequest, ResponseObject } from "../../../providers/types";

function encoded(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text ? encode(text).length : 0;
}

export function estimateResponseInputTokens(request: ResponseCreateRequest): number {
  return Math.max(
    0,
    3 +
      encoded(request.instructions) +
      encoded(request.input) +
      encoded(request.tools) +
      encoded(request.tool_choice) +
      encoded(request.text),
  );
}

export function estimateResponseOutputTokens(response: ResponseObject): number {
  return encoded(response.output);
}

export function estimateResponseStreamPayloadTokens(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const event = payload as Record<string, unknown>;
  if (typeof event.delta === "string") return encoded(event.delta);
  return 0;
}
