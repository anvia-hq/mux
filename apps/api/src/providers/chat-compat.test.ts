import { describe, expect, it } from "vitest";
import {
  applyRuntimeCapabilities,
  buildOpenAICompatibleRequestBody,
  unsupportedNativeCapabilities,
  validateChatCompletionRequestShape,
} from "./chat-compat";
import type { ChatCompletionRequest, Model } from "./types";

const openAICompatibleRequestFields = [
  "model",
  "messages",
  "temperature",
  "max_tokens",
  "max_completion_tokens",
  "stream",
  "stream_options",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "top_p",
  "stop",
  "n",
  "seed",
  "frequency_penalty",
  "presence_penalty",
  "logit_bias",
  "logprobs",
  "top_logprobs",
  "user",
  "metadata",
  "store",
  "service_tier",
  "reasoning_effort",
  "modalities",
  "audio",
] as const satisfies readonly (keyof ChatCompletionRequest)[];

type MissingForwardedFields = Exclude<
  keyof ChatCompletionRequest,
  (typeof openAICompatibleRequestFields)[number]
>;
type UnknownForwardedFields = Exclude<
  (typeof openAICompatibleRequestFields)[number],
  keyof ChatCompletionRequest
>;
const _openAICompatibleFieldCoverage: [MissingForwardedFields, UnknownForwardedFields] extends [
  never,
  never,
]
  ? true
  : never = true;

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
                function: { name: "lookup", arguments: '{"query":"mux"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "result" },
        ],
      }),
    ).toBeNull();
  });

  it("forwards every OpenAI-compatible chat request field", () => {
    const request: ChatCompletionRequest = {
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      temperature: 1,
      max_tokens: 10,
      max_completion_tokens: 20,
      stream: false,
      stream_options: { include_usage: false },
      tools: [{ type: "function", function: { name: "lookup" } }],
      tool_choice: "auto",
      parallel_tool_calls: true,
      response_format: { type: "json_object" },
      top_p: 1,
      stop: ["END"],
      n: 1,
      seed: 123,
      frequency_penalty: 0,
      presence_penalty: 0,
      logit_bias: { "1": -1 },
      logprobs: true,
      top_logprobs: 1,
      user: "user-1",
      metadata: { trace: "trace-1" },
      store: false,
      service_tier: "default",
      reasoning_effort: "low",
      modalities: ["text"],
      audio: { voice: "alloy", format: "mp3" },
    };

    const body = JSON.parse(buildOpenAICompatibleRequestBody(request, true)) as Record<
      string,
      unknown
    >;

    expect(Object.keys(body).sort()).toEqual([...openAICompatibleRequestFields].sort());
    expect(body.max_completion_tokens).toBe(20);
    expect(body.stream_options).toEqual({ include_usage: false });
  });
});
