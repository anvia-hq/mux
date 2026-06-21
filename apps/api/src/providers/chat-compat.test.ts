import { describe, expect, it } from "vitest";
import {
  applyRuntimeCapabilities,
  unsupportedNativeCapabilities,
  validateChatCompletionRequestShape,
} from "./chat-compat";
import type { Model } from "./types";

describe("chat compatibility", () => {
  it("removes advertised capabilities that mux cannot execute for a provider path", () => {
    const model: Model = {
      id: "m1",
      name: "M1",
      provider: "native",
      inputPricePer1M: 1,
      outputPricePer1M: 1,
      contextWindow: 1,
      maxOutputTokens: 1,
      inputModalities: ["text", "image", "audio", "pdf"],
      outputModalities: ["text", "audio"],
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      weights: "closed",
    };

    expect(applyRuntimeCapabilities(model, unsupportedNativeCapabilities)).toMatchObject({
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: false,
      toolCall: false,
      structuredOutput: false,
    });
  });

  it("accepts OpenAI assistant refusal content parts in message history", () => {
    expect(
      validateChatCompletionRequestShape({
        model: "openai:gpt-4.1",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
          {
            role: "assistant",
            content: [{ type: "refusal", refusal: "I cannot help with that." }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("accepts assistant tool-call messages without content", () => {
    expect(
      validateChatCompletionRequestShape({
        model: "openai:gpt-4.1",
        messages: [
          { role: "user", content: "call a tool" },
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: "{\"query\":\"mux\"}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "result" },
        ],
      }),
    ).toBeNull();
  });
});
