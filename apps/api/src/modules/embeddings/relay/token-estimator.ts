import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { EmbeddingInput } from "../../../providers/types";

function stringTokens(value: string): number {
  return value ? encode(value).length : 0;
}

export function estimateEmbeddingInputTokens(input: EmbeddingInput): number {
  if (typeof input === "string") return stringTokens(input);
  if (input.length === 0) return 0;
  if (typeof input[0] === "string") {
    return (input as string[]).reduce((total, value) => total + stringTokens(value), 0);
  }
  if (Array.isArray(input[0])) {
    return (input as number[][]).reduce((total, value) => total + value.length, 0);
  }
  return (input as number[]).length;
}
