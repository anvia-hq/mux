import { describe, expect, it } from "vitest";

import { createToolCallId, normalizeMistralToolCallIds } from "../../src/providers/tool-calls";
import type { ChatCompletionRequest } from "../../src/providers/types";

describe("tool call helpers", () => {
  it("creates unique OpenAI-style tool call IDs", () => {
    const first = createToolCallId();
    const second = createToolCallId();

    expect(first).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(second).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("normalizes Mistral IDs consistently without mutating the request", () => {
    const request: ChatCompletionRequest = {
      model: "mistral-test",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_needs_rewriting",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
            {
              id: "Abc123xyz",
              type: "function",
              function: { name: "weather", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_needs_rewriting", content: "ok" },
        { role: "tool", tool_call_id: "Abc123xyz", content: "sunny" },
      ],
    };

    const normalized = normalizeMistralToolCallIds(request);
    const rewritten = normalized.messages[0]?.tool_calls?.[0]?.id;

    expect(rewritten).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(normalized.messages[1]?.tool_call_id).toBe(rewritten);
    expect(normalized.messages[0]?.tool_calls?.[1]?.id).toBe("Abc123xyz");
    expect(normalized.messages[2]?.tool_call_id).toBe("Abc123xyz");
    expect(request.messages[0]?.tool_calls?.[0]?.id).toBe("call_needs_rewriting");
  });
});
