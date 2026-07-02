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
} from "../../src/providers/chat-compat";
import type { ChatCompletionRequest, Model } from "../../src/providers/types";

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

  it("preserves broad OpenAI-compatible chat request fields", () => {
    const request = {
      model: "gpt-4.1",
      messages: [
        { role: "developer", content: "be terse", reasoning_content: "hidden" },
        {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "video_url", video_url: { url: "https://x.test/video.mp4" } },
          ],
          cache_control: { type: "ephemeral" },
        },
        { role: "function", name: "lookup", content: "result" },
      ],
      prompt: "legacy prompt",
      temperature: 0,
      top_k: 0,
      max_tokens: 10,
      max_completion_tokens: 20,
      stream: false,
      stream_options: { include_usage: false },
      tools: [{ type: "function", function: { name: "lookup" } }],
      functions: [{ name: "legacy_lookup", parameters: { type: "object" } }],
      function_call: { name: "legacy_lookup" },
      tool_choice: "auto",
      parallel_tool_calls: false,
      response_format: { type: "json_object" },
      top_p: 0,
      stop: ["END"],
      n: 1,
      input: "input text",
      instruction: "edit instruction",
      size: "1024x1024",
      seed: 123,
      frequency_penalty: 0,
      presence_penalty: 0,
      encoding_format: "float",
      logit_bias: { "1": -1 },
      logprobs: false,
      top_logprobs: 1,
      dimensions: 1536,
      user: "user-1",
      metadata: { trace: "trace-1", attempt: 0 },
      store: false,
      service_tier: "default",
      reasoning_effort: "low",
      modalities: ["text"],
      audio: { voice: "alloy", format: "mp3" },
      prediction: { type: "content", content: "expected" },
      verbosity: "low",
      safety_identifier: "safe-user-1",
      prompt_cache_key: "cache-key",
      prompt_cache_retention: null,
      web_search_options: { search_context_size: "medium" },
      search_parameters: { mode: "web" },
      usage: { include: true },
      extra_body: { provider: { option: true } },
      reasoning: { effort: "low" },
      vl_high_resolution_images: true,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
      enable_search: true,
      web_search: { enable: true },
      thinking: { type: "enabled" },
      think: false,
      search_domain_filter: ["example.com"],
      search_recency_filter: "month",
      return_images: false,
      return_related_questions: false,
      search_mode: "auto",
      reasoning_split: true,
    } as unknown as ChatCompletionRequest;

    const body = JSON.parse(buildOpenAICompatibleRequestBody(request, false)) as Record<
      string,
      unknown
    >;

    expect(body.model).toBe("gpt-4.1");
    expect(body.temperature).toBe(0);
    expect(body.max_completion_tokens).toBe(20);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.top_p).toBe(0);
    expect(body.logprobs).toBe(false);
    expect(body.store).toBe(false);
    expect(body.prompt_cache_retention).toBeNull();
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("stream_options");
    expect(body.functions).toEqual([{ name: "legacy_lookup", parameters: { type: "object" } }]);
    expect(body.prompt).toBe("legacy prompt");
    expect(body.top_k).toBe(0);
    expect(body.input).toBe("input text");
    expect(body.instruction).toBe("edit instruction");
    expect(body.size).toBe("1024x1024");
    expect(body.encoding_format).toBe("float");
    expect(body.dimensions).toBe(1536);
    expect(body.web_search_options).toEqual({ search_context_size: "medium" });
    expect(body.usage).toEqual({ include: true });
    expect(body.extra_body).toEqual({ provider: { option: true } });
    expect(body.vl_high_resolution_images).toBe(true);
    expect(body.enable_thinking).toBe(false);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.enable_search).toBe(true);
    expect(body.web_search).toEqual({ enable: true });
    expect(body.search_domain_filter).toEqual(["example.com"]);
    expect(body.search_recency_filter).toBe("month");
    expect(body.return_images).toBe(false);
    expect(body.return_related_questions).toBe(false);
    expect(body.search_mode).toBe("auto");
    expect(body.reasoning_split).toBe(true);
  });

  it("omits stream for non-streamed upstream bodies when the client omitted it", () => {
    const body = JSON.parse(
      buildOpenAICompatibleRequestBody(
        {
          model: "gpt-5.5",
          messages: [{ role: "user", content: "hi" }],
        },
        false,
      ),
    ) as Record<string, unknown>;

    expect(body).not.toHaveProperty("stream");
  });

  it("forces stream usage for streamed OpenAI-compatible upstream bodies", () => {
    const body = JSON.parse(
      buildOpenAICompatibleRequestBody(
        {
          model: "gpt-5.5",
          messages: [{ role: "user", content: "hi" }],
          stream_options: { include_usage: false, include_obfuscation: true },
        },
        true,
      ),
    ) as Record<string, unknown>;

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("normalizes OpenAI GPT-5 upstream chat requests like new-api", () => {
    const body = JSON.parse(
      buildOpenAICompatibleRequestBody(
        {
          model: "gpt-5-high",
          messages: [{ role: "system", content: "be precise" }],
          max_tokens: 128,
          temperature: 0.2,
          top_p: 0.9,
          logprobs: true,
        },
        false,
      ),
    ) as Record<string, unknown>;

    expect(body.model).toBe("gpt-5");
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBe(128);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.logprobs).toBeUndefined();
    expect(body.reasoning_effort).toBe("high");
    expect(body.messages).toEqual([{ role: "developer", content: "be precise" }]);
  });

  it("normalizes OpenAI o-series upstream chat requests like new-api", () => {
    const body = JSON.parse(
      buildOpenAICompatibleRequestBody(
        {
          model: "o3-low",
          messages: [{ role: "system", content: "be precise" }],
          max_tokens: 128,
          max_completion_tokens: 0,
          temperature: 0.2,
          top_p: 0.9,
          logprobs: true,
        },
        false,
      ),
    ) as Record<string, unknown>;

    expect(body.model).toBe("o3");
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBe(128);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBe(0.9);
    expect(body.logprobs).toBe(true);
    expect(body.reasoning_effort).toBe("low");
    expect(body.messages).toEqual([{ role: "developer", content: "be precise" }]);
  });

  it("validates malformed chat requests", () => {
    const invalidRequests = [
      [null, "request body must be an object"],
      [{ messages: [] }, "request must include a model"],
      [
        { model: "m1", messages: [] },
        "request must include a non-empty messages array or prefix/suffix",
      ],
      [
        { model: "m1", messages: [], prefix: null },
        "request must include a non-empty messages array or prefix/suffix",
      ],
      [
        { model: "m1", messages: [{ role: "user", content: "x" }], max_tokens: 2 ** 30 },
        "max_tokens is invalid",
      ],
      [{ model: "m1", messages: "bad" }, "messages must be an array"],
      [{ model: "m1", messages: [null] }, "messages[0] must be an object"],
      [
        {
          model: "m1",
          messages: [{ role: "user", content: "x" }],
          web_search_options: { search_context_size: "massive" },
        },
        "invalid search_context_size, must be one of: high, medium, low",
      ],
    ] as const;

    for (const [request, message] of invalidRequests) {
      expect(validateChatCompletionRequestShape(request)).toBe(message);
    }
  });

  it("accepts FIM requests without messages", () => {
    expect(
      validateChatCompletionRequestShape({ model: "m1", prefix: "function a() {" }),
    ).toBeNull();
    expect(validateChatCompletionRequestShape({ model: "m1", prefix: "" })).toBeNull();
    expect(validateChatCompletionRequestShape({ model: "m1", prefix: 0 })).toBeNull();
    expect(validateChatCompletionRequestShape({ model: "m1", suffix: false })).toBeNull();
    expect(validateChatCompletionRequestShape({ model: "m1", suffix: "}" })).toBeNull();
    expect(
      validateChatCompletionRequestShape({ model: "m1", messages: [], prefix: "function a() {" }),
    ).toBeNull();
  });

  it("defaults web_search_options.search_context_size to medium", () => {
    const request = {
      model: "m1",
      messages: [{ role: "user", content: "search" }],
      web_search_options: {},
    };

    expect(validateChatCompletionRequestShape(request)).toBeNull();
    expect(request.web_search_options).toEqual({ search_context_size: "medium" });
  });

  it("accepts broad provider-specific roles and content part shapes", () => {
    expect(
      validateChatCompletionRequestShape({
        model: "m1",
        messages: [
          { role: "developer", content: "instructions" },
          { role: "function", name: "lookup", content: "result" },
          {
            role: "user",
            content: [
              { type: "text", text: "hi" },
              { type: "image_url", image_url: { url: "https://x.test/image.png" } },
              { type: "input_audio", input_audio: { data: "abc", format: "wav" } },
              { type: "file", file: { file_data: "abc" } },
              { type: "video_url", video_url: { url: "https://x.test/video.mp4" } },
            ],
            cache_control: { type: "ephemeral" },
          },
          { role: "assistant", reasoning_content: "hidden", content: null },
        ],
        response_format: { type: "xml" },
        modalities: ["video"],
      }),
    ).toBeNull();
  });
});
