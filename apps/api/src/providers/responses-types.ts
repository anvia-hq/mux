/**
 * Typed input and output item unions for the OpenAI Responses API.
 *
 * These types model the spec's discriminated unions and are re-exported from
 * `apps/api/src/providers/types.ts` so existing imports keep working. New
 * variants (image, file, audio, web_search, code_interpreter, mcp, etc.)
 * will be added in later plan items (P1.x, P9.x); this module only covers
 * the variants the current gateway exercises.
 */

export type ResponseInputTextParam = {
  type: "input_text";
  text: string;
};

export type ResponseInputMessage = {
  type: "message";
  role: "user" | "system" | "assistant" | "developer";
  content: ResponseInputTextParam[];
  status?: "in_progress" | "completed" | "incomplete";
};

export type ResponseReferenceItemParam = {
  type: "item_reference";
  id: string;
};

export type ResponseInputItem =
  | ResponseInputMessage
  | ResponseInputTextParam
  | ResponseReferenceItemParam;

export type ResponseOutputText = {
  type: "output_text";
  text: string;
  annotations?: unknown[];
  logprobs?: unknown[];
};

export type ResponseOutputRefusal = {
  type: "refusal";
  refusal: string;
};

export type ResponseOutputMessage = {
  id: string;
  type: "message";
  role: "assistant";
  status: "in_progress" | "completed" | "incomplete";
  content: (ResponseOutputText | ResponseOutputRefusal)[];
};

export type ResponseFunctionToolCall = {
  id: string;
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  status?: "in_progress" | "completed" | "incomplete";
};

export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseOutputText
  | ResponseOutputRefusal
  | ResponseFunctionToolCall;

export type ResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    [key: string]: unknown;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ResponseObject = {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "queued" | "in_progress" | "completed" | "incomplete" | "failed" | "cancelled";
  output: ResponseOutputItem[];
  usage?: ResponseUsage;
  error?: {
    message: string;
    type?: string;
    code?: string | null;
    param?: string | null;
  } | null;
  metadata?: Record<string, string> | null;
  [key: string]: unknown;
};

/**
 * Exhaustiveness helper. Use in a `switch` default branch to force a
 * compile-time error if a new union member is added without handling it.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
