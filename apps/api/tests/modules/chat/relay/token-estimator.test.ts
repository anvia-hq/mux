import { describe, expect, it } from "vitest";
import {
  estimateChatChunkTokens,
  estimateChatInputTokens,
  estimateChatOutputTokens,
  requestedOutputTokenLimit,
} from "../../../../src/modules/chat/relay/token-estimator";

describe("chat token estimator", () => {
  it("counts chat framing, tools, and media without tokenizing base64 payloads", () => {
    const base = estimateChatInputTokens({
      model: "openai:gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    });
    const multimodal = estimateChatInputTokens({
      model: "openai:gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${"a".repeat(10_000)}` },
            },
            { type: "input_audio", input_audio: { data: "b".repeat(10_000), format: "wav" } },
          ],
        },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    });
    expect(multimodal).toBeGreaterThan(base + 520 + 256);
    expect(multimodal).toBeLessThan(2_000);
  });

  it("uses the larger explicit output cap", () => {
    expect(
      requestedOutputTokenLimit({
        model: "m",
        messages: [],
        max_tokens: 100,
        max_completion_tokens: 200,
      }),
    ).toBe(200);
  });

  it("estimates observed output when upstream usage is unavailable", () => {
    expect(
      estimateChatOutputTokens({
        id: "chat-1",
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hello world" },
            finish_reason: "stop",
          },
        ],
        usage: undefined as never,
      }),
    ).toBeGreaterThan(2);
    expect(
      estimateChatChunkTokens({
        id: "chunk-1",
        model: "m",
        choices: [
          {
            index: 0,
            delta: {
              content: "hello",
              tool_calls: [{ function: { name: "lookup", arguments: '{"id":' } }],
            },
            finish_reason: null,
          },
        ],
      }),
    ).toBeGreaterThan(2);
  });
});
