import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { AnthropicMessageCreateRequest } from "../../../providers/types";

function encoded(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text ? encode(text).length : 0;
}

export function estimateAnthropicMessageInputTokens(
  request: AnthropicMessageCreateRequest,
): number {
  return Math.max(
    0,
    3 +
      encoded(request.system) +
      encoded(request.messages) +
      encoded(request.tools) +
      encoded(request.tool_choice) +
      encoded(request.thinking) +
      encoded(request.output_config) +
      encoded(request.metadata),
  );
}

export function estimateAnthropicStreamOutputTokens(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const event = payload as { delta?: { text?: unknown; partial_json?: unknown } };
  if (typeof event.delta?.text === "string") return encoded(event.delta.text);
  if (typeof event.delta?.partial_json === "string") return encoded(event.delta.partial_json);
  return 0;
}
