import { describe, expect, it } from "vitest";
import {
  responseCompactRequestSchema,
  responseCreateRequestSchema,
} from "../../src/providers/responses-schema";

describe("responseCreateRequestSchema", () => {
  it("rejects a model without input", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "openai:gpt-4o" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((issue) => issue.path.join("."));
      expect(issuePaths).toContain("input");
    }
  });

  it("accepts model + string input", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "openai:gpt-4o",
      input: "hi",
    });
    expect(result.success).toBe(true);
  });

  it("accepts model + message array input", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "openai:gpt-4o",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing model", () => {
    const result = responseCreateRequestSchema.safeParse({ input: "hi" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((issue) => issue.path.join("."));
      expect(issuePaths).toContain("model");
    }
  });

  it("rejects empty model string", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((issue) => issue.path.join("."));
      expect(issuePaths).toContain("model");
    }
  });

  it("accepts empty input string as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", input: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty input array as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", input: [] });
    expect(result.success).toBe(true);
  });

  it("accepts input array with empty content as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "user", content: [] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts input message with invalid role as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "tool", content: [{ type: "input_text", text: "hi" }] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts input message with string content", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "user", content: "hi" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multimodal input content parts", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "describe this" },
            { type: "input_image", image_url: "https://example.test/image.png", detail: "low" },
            { type: "input_file", file_id: "file_1", filename: "notes.txt" },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-message input items", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "item_reference", id: "msg_1" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("responseCreateRequestSchema — extended fields", () => {
  it("accepts instructions, stream, background as booleans / strings", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      instructions: "be brief",
      stream: true,
      background: false,
    });
    expect(result.success).toBe(true);
  });

  it("preserves Responses create passthrough fields", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      include: ["file_search_call.results", "reasoning.encrypted_content"],
      conversation: { id: "conv_1" },
      context_management: { truncation: "auto" },
      enable_thinking: false,
      instructions: { text: "be brief" },
      max_tool_calls: 0,
      parallel_tool_calls: false,
      previous_response_id: "resp_prev",
      prompt_cache_key: "cache-key",
      prompt_cache_retention: { type: "ephemeral" },
      preset: "sonar",
      stream_options: { include_usage: true, include_obfuscation: true },
      top_logprobs: 0,
      top_p: 0,
      user: { id: "user-1" },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toMatchObject({
      include: ["file_search_call.results", "reasoning.encrypted_content"],
      conversation: { id: "conv_1" },
      context_management: { truncation: "auto" },
      enable_thinking: false,
      instructions: { text: "be brief" },
      max_tool_calls: 0,
      parallel_tool_calls: false,
      previous_response_id: "resp_prev",
      prompt_cache_key: "cache-key",
      prompt_cache_retention: { type: "ephemeral" },
      preset: "sonar",
      stream_options: { include_usage: true, include_obfuscation: true },
      top_logprobs: 0,
      top_p: 0,
      user: { id: "user-1" },
    });
  });

  it("strips null optional typed fields like Go pointer and string decoding", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      background: null,
      max_output_tokens: null,
      max_tool_calls: null,
      previous_response_id: null,
      reasoning: null,
      service_tier: null,
      stream: null,
      stream_options: null,
      temperature: null,
      top_logprobs: null,
      top_p: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toEqual({ model: "x", input: "hi" });
  });

  it("preserves null raw JSON fields", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: null,
      instructions: null,
      metadata: null,
      tools: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toEqual({
      model: "x",
      input: null,
      instructions: null,
      metadata: null,
      tools: null,
    });
  });

  it("rejects stream as non-boolean", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      stream: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("accepts tools as opaque array (P1.2 tightens)", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "function", name: "lookup" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts tool_choice when name is missing as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: { type: "function", function: {} },
    });
    expect(result.success).toBe(true);
  });

  it("accepts tool_choice = 'auto'", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: "auto",
    });
    expect(result.success).toBe(true);
  });

  it("accepts explicit zero max_output_tokens and rejects negative values", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", max_output_tokens: 0 })
        .success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", max_output_tokens: -1 })
        .success,
    ).toBe(false);
  });

  it("accepts any numeric temperature", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", temperature: -0.1 }).success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", temperature: 2.5 }).success,
    ).toBe(true);
  });

  it("matches Go typed scalar validation", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", max_tool_calls: -1 })
        .success,
    ).toBe(false);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", previous_response_id: "" })
        .success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", top_logprobs: -1 }).success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", top_p: 1.1 }).success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        input: "hi",
        stream_options: { include_obfuscation: "yes" },
      }).success,
    ).toBe(false);
  });

  it("accepts metadata as string record", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      metadata: { trace: "t1", user: "u1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts metadata with non-string values as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      metadata: { trace: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts truncation 'auto' / 'disabled'", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", truncation: "auto" })
        .success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", truncation: "disabled" })
        .success,
    ).toBe(true);
  });

  it("accepts truncation with unknown value as raw JSON", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", truncation: "maybe" })
        .success,
    ).toBe(true);
  });

  it("accepts prompt as string or structured object", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", prompt: "summarize" })
        .success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        input: "hi",
        prompt: { id: "summarizer", variables: { topic: "x" } },
      }).success,
    ).toBe(true);
  });

  it("accepts reasoning effort levels", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(
        responseCreateRequestSchema.safeParse({ model: "x", input: "hi", reasoning: { effort } })
          .success,
      ).toBe(true);
    }
  });

  it("accepts unknown reasoning effort as a typed string field", () => {
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        input: "hi",
        reasoning: { effort: "ultra" },
      }).success,
    ).toBe(true);
  });
});

describe("responseCreateRequestSchema — tools", () => {
  it("accepts a function tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "look up a record",
          parameters: { type: "object", properties: { q: { type: "string" } } },
          strict: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a web_search tool with filters", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [
        {
          type: "web_search",
          filters: { allowed_domains: ["openai.com"] },
          search_context_size: "high",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a file_search tool with vector store ids", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "file_search", vector_store_ids: ["vs_1"] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts file_search without vector_store_ids as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "file_search" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a code_interpreter tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an mcp tool with required server fields", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [
        {
          type: "mcp",
          server_label: "github",
          server_url: "https://mcp.example.com",
          headers: { Authorization: "Bearer x" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts mcp without server_url as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "mcp", server_label: "github" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts mcp with malformed server_url as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "mcp", server_label: "github", server_url: "not-a-url" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a custom tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "custom", name: "render", description: "render a chart" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an apply_patch tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "apply_patch" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts unknown tool type as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [{ type: "bogus" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a mixed list of tool types", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tools: [
        { type: "function", name: "lookup" },
        { type: "web_search" },
        { type: "apply_patch" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("responseCreateRequestSchema — tool_choice hosted form", () => {
  it.each([
    "web_search",
    "file_search",
    "code_interpreter",
    "mcp",
    "custom",
    "apply_patch",
  ] as const)("accepts hosted tool_choice type=%s", (type) => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: { type },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hosted tool_choice with name", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: { type: "custom", name: "render" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hosted tool_choice with unknown type as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: { type: "bogus" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts function tool_choice when name is missing as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      tool_choice: { type: "function", function: {} },
    });
    expect(result.success).toBe(true);
  });
});

describe("responseCreateRequestSchema — text.format", () => {
  it("accepts text format", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: { format: { type: "text" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_object format", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: { format: { type: "json_object" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_schema format with name, schema, strict", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          description: "structured answer",
          schema: { type: "object", properties: { value: { type: "string" } } },
          strict: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_schema without name as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: { format: { type: "json_schema", schema: { type: "object" } } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_schema without schema as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: { format: { type: "json_schema", name: "answer" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts unknown format type as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: { format: { type: "yaml" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts text as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      text: "free-form",
    });
    expect(result.success).toBe(true);
  });
});

describe("responseCreateRequestSchema — service_tier and safety_identifier", () => {
  it.each(["auto", "default", "flex", "priority"] as const)("accepts service_tier=%s", (tier) => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      service_tier: tier,
    });
    expect(result.success).toBe(true);
  });

  it("accepts unknown service_tier string", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      service_tier: "pro",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a 1–64 char safety_identifier", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", input: "hi", safety_identifier: "u1" })
        .success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        input: "hi",
        safety_identifier: "u".repeat(64),
      }).success,
    ).toBe(true);
  });

  it("accepts empty safety_identifier as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      safety_identifier: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts safety_identifier over 64 chars as raw JSON", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      safety_identifier: "u".repeat(65),
    });
    expect(result.success).toBe(true);
  });
});

describe("responseCreateRequestSchema — stream + background conflict", () => {
  it("rejects stream=true and background=true with param=background", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      stream: true,
      background: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(["background"]);
      expect(issue?.message).toMatch(/stream and background/);
    }
  });

  it("accepts stream=true with background=false", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      stream: true,
      background: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts stream=false with background=true (handler returns 422)", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: "hi",
      stream: false,
      background: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts neither stream nor background set", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", input: "hi" });
    expect(result.success).toBe(true);
  });
});

describe("responseCompactRequestSchema", () => {
  it("accepts model only", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "gpt-5" });
    expect(result.success).toBe(true);
  });

  it("accepts model with a string input", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "gpt-5",
      input: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts model with an array input of arbitrary objects", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "gpt-5",
      input: [
        { role: "user", content: "hi" },
        { id: "msg_1", type: "message" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts instructions and previous_response_id", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "gpt-5",
      input: "hello",
      instructions: { text: "preserve tool state" },
      previous_response_id: "resp_prev",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty model", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing model", () => {
    const result = responseCompactRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts empty string input as raw JSON", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "x", input: "" });
    expect(result.success).toBe(true);
  });

  it("accepts empty array input as raw JSON", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "x", input: [] });
    expect(result.success).toBe(true);
  });

  it("accepts empty previous_response_id", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "x",
      input: "hi",
      previous_response_id: "",
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown fields like Go struct decoding", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "x",
      input: "hi",
      unknown: "nope",
    });
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).not.toHaveProperty("unknown");
  });

  it("strips null previous_response_id while preserving raw null fields", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "x",
      input: null,
      instructions: null,
      previous_response_id: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toEqual({
      model: "x",
      input: null,
      instructions: null,
    });
  });
});
