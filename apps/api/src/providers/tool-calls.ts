import { randomUUID } from "node:crypto";

import type { ChatCompletionRequest } from "./types";

const MISTRAL_TOOL_CALL_ID = /^[a-zA-Z0-9]{9}$/;

export function createToolCallId(): string {
  return `call_${randomUUID()}`;
}

export function normalizeMistralToolCallIds(request: ChatCompletionRequest): ChatCompletionRequest {
  const replacements = new Map<string, string>();
  const normalizeId = (id: string): string => {
    if (MISTRAL_TOOL_CALL_ID.test(id)) return id;
    const existing = replacements.get(id);
    if (existing) return existing;
    const replacement = randomUUID().replaceAll("-", "").slice(0, 9);
    replacements.set(id, replacement);
    return replacement;
  };

  return {
    ...request,
    messages: request.messages.map((message) => ({
      ...message,
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((toolCall) => ({
              ...toolCall,
              id: normalizeId(toolCall.id),
              function: { ...toolCall.function },
            })),
          }
        : {}),
      ...(message.tool_call_id ? { tool_call_id: normalizeId(message.tool_call_id) } : {}),
    })),
  };
}
