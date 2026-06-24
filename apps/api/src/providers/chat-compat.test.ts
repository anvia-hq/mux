import { describe, expect, it } from "vitest";
import {
  applyRuntimeCapabilities,
  assertChatFeaturesSupported,
  buildOpenAICompatibleRequestBody,
  requestedChatFeatures,
  unsupportedChatFeatures,
  unsupportedNativeCapabilities,
  UnsupportedChatFeatureError,
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
  const model: Model = {
    id: "m1",
    name: "M1",
    provider: "test",
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

  it("removes advertised capabilities that mux cannot execute for a provider path", () => {
    expect(applyRuntimeCapabilities(model, unsupportedNativeCapabilities)).toMatchObject({
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoning: false,
      toolCall: false,
      structuredOutput: false,
    });
  });

  it("detects all requested feature categories", () => {
    const features = requestedChatFeatures({
      model: "openai:gpt-4.1",
      messages: [
        { role: "user", content: [{ type: "image_url", image_url: { url: "https://x.test" } }] },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
      tools: [{ type: "function", function: { name: "lookup" } }],
      tool_choice: "auto",
      parallel_tool_calls: true,
      response_format: { type: "json_schema", json_schema: { name: "answer" } },
      modalities: ["audio"],
      audio: { voice: "alloy", format: "mp3" },
      reasoning_effort: "low",
      logprobs: true,
      top_logprobs: 1,
    });

    expect([...features].sort()).toEqual(
      [
        "audioOutput",
        "logprobs",
        "multimodalInput",
        "reasoning",
        "structuredOutput",
        "tools",
      ].sort(),
    );
  });

  it("reports unsupported features from provider and model capabilities", () => {
    const unsupported = unsupportedChatFeatures(
      {
        model: "native:m1",
        messages: [
          { role: "user", content: [{ type: "file", file: { file_id: "file-1" } }] },
          { role: "assistant", content: "calling", tool_calls: [] },
        ],
        tools: [{ type: "function", function: { name: "lookup" } }],
        response_format: { type: "json_object" },
        modalities: ["audio"],
        reasoning_effort: "high",
      },
      {
        ...model,
        inputModalities: ["text"],
        outputModalities: ["text"],
        reasoning: false,
        toolCall: false,
        structuredOutput: false,
      },
      unsupportedNativeCapabilities,
    );

    expect(unsupported).toEqual(
      expect.arrayContaining([
        "audioOutput",
        "multimodalInput",
        "reasoning",
        "structuredOutput",
        "tools",
      ]),
    );
  });

  it("throws a typed error when asserted features are unsupported", () => {
    expect(() =>
      assertChatFeaturesSupported(
        {
          model: "native:m1",
          messages: [{ role: "user", content: "hi" }],
          response_format: { type: "json_object" },
        },
        { ...model, structuredOutput: false },
        "native:m1",
        unsupportedNativeCapabilities,
      ),
    ).toThrow(UnsupportedChatFeatureError);
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

  it("adds stream usage by default for streamed OpenAI-compatible bodies", () => {
    const body = JSON.parse(
      buildOpenAICompatibleRequestBody(
        {
          model: "gpt-5.5",
          messages: [{ role: "user", content: "hi" }],
          stream_options: {},
        },
        true,
      ),
    ) as Record<string, unknown>;

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("validates malformed chat requests", () => {
    const invalidRequests = [
      [null, "request body must be an object"],
      [{ messages: [] }, "request must include a model"],
      [{ model: "m1", messages: [] }, "request must include a non-empty messages array"],
      [{ model: "m1", messages: [null] }, "messages[0] must be an object"],
      [{ model: "m1", messages: [{ role: "bad", content: "x" }] }, "messages[0].role is invalid"],
      [
        { model: "m1", messages: [{ role: "tool", content: "x" }] },
        "messages[0].tool_call_id is required for tool messages",
      ],
      [
        { model: "m1", messages: [{ role: "assistant", tool_calls: [{ type: "function" }] }] },
        "messages[0].tool_calls is invalid",
      ],
      [
        { model: "m1", messages: [{ role: "user", content: [{ type: "text" }] }] },
        "messages[0].content is invalid",
      ],
      [
        { model: "m1", messages: [{ role: "user", content: "x" }], tools: [{ type: "bad" }] },
        "tools must be an array of function tools",
      ],
      [
        {
          model: "m1",
          messages: [{ role: "user", content: "x" }],
          response_format: { type: "xml" },
        },
        "response_format.type is invalid",
      ],
      [
        { model: "m1", messages: [{ role: "user", content: "x" }], modalities: ["video"] },
        "modalities must contain only text or audio",
      ],
    ] as const;

    for (const [request, message] of invalidRequests) {
      expect(validateChatCompletionRequestShape(request)).toBe(message);
    }
  });

  it("accepts every supported content part shape", () => {
    expect(
      validateChatCompletionRequestShape({
        model: "m1",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hi" },
              { type: "image_url", image_url: { url: "https://x.test/image.png" } },
              { type: "input_audio", input_audio: { data: "abc", format: "wav" } },
              { type: "file", file: { file_data: "abc" } },
            ],
          },
        ],
      }),
    ).toBeNull();
  });
});
