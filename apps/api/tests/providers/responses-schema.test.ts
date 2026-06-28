import { describe, expect, it } from "vitest";
import {
  responseCompactRequestSchema,
  responseCreateRequestSchema,
} from "../../src/providers/responses-schema";

describe("responseCreateRequestSchema", () => {
  it("accepts a model only", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "openai:gpt-4o" });
    expect(result.success).toBe(true);
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

  it("rejects empty input string", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", input: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty input array", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", input: [] });
    expect(result.success).toBe(false);
  });

  it("rejects input array with empty content", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "user", content: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects input message with invalid role", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "tool", content: [{ type: "input_text", text: "hi" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects input message with wrong content shape", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [{ type: "message", role: "user", content: [{ type: "input_image", url: "x" }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("responseCreateRequestSchema — extended fields", () => {
  it("accepts instructions, stream, background as booleans / strings", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      instructions: "be brief",
      stream: true,
      background: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects stream as non-boolean", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", stream: "yes" });
    expect(result.success).toBe(false);
  });

  it("accepts tools as opaque array (P1.2 tightens)", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "function", name: "lookup" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects tool_choice when name is missing", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tool_choice: { type: "function", function: {} },
    });
    expect(result.success).toBe(false);
  });

  it("accepts tool_choice = 'auto'", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", tool_choice: "auto" });
    expect(result.success).toBe(true);
  });

  it("rejects max_output_tokens when not positive", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", max_output_tokens: 0 }).success,
    ).toBe(false);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", max_output_tokens: -1 }).success,
    ).toBe(false);
  });

  it("rejects temperature out of [0, 2]", () => {
    expect(responseCreateRequestSchema.safeParse({ model: "x", temperature: -0.1 }).success).toBe(
      false,
    );
    expect(responseCreateRequestSchema.safeParse({ model: "x", temperature: 2.5 }).success).toBe(
      false,
    );
  });

  it("accepts metadata as string record", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      metadata: { trace: "t1", user: "u1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects metadata with non-string values", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      metadata: { trace: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts truncation 'auto' / 'disabled'", () => {
    expect(responseCreateRequestSchema.safeParse({ model: "x", truncation: "auto" }).success).toBe(
      true,
    );
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", truncation: "disabled" }).success,
    ).toBe(true);
  });

  it("rejects truncation with unknown value", () => {
    expect(responseCreateRequestSchema.safeParse({ model: "x", truncation: "maybe" }).success).toBe(
      false,
    );
  });

  it("accepts prompt as string or structured object", () => {
    expect(responseCreateRequestSchema.safeParse({ model: "x", prompt: "summarize" }).success).toBe(
      true,
    );
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        prompt: { id: "summarizer", variables: { topic: "x" } },
      }).success,
    ).toBe(true);
  });

  it("accepts reasoning effort levels", () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(
        responseCreateRequestSchema.safeParse({ model: "x", reasoning: { effort } }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown reasoning effort", () => {
    expect(
      responseCreateRequestSchema.safeParse({
        model: "x",
        reasoning: { effort: "ultra" },
      }).success,
    ).toBe(false);
  });
});

describe("responseCreateRequestSchema — tools", () => {
  it("accepts a function tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
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
      tools: [{ type: "file_search", vector_store_ids: ["vs_1"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects file_search without vector_store_ids", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "file_search" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a code_interpreter tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an mcp tool with required server fields", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
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

  it("rejects mcp without server_url", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "mcp", server_label: "github" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects mcp with malformed server_url", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "mcp", server_label: "github", server_url: "not-a-url" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a custom tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "custom", name: "render", description: "render a chart" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an apply_patch tool", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "apply_patch" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown tool type via discriminator", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tools: [{ type: "bogus" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a mixed list of tool types", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
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
      tool_choice: { type },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hosted tool_choice with name", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tool_choice: { type: "custom", name: "render" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects hosted tool_choice with unknown type", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tool_choice: { type: "bogus" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects function tool_choice when name is missing", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      tool_choice: { type: "function", function: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe("responseCreateRequestSchema — text.format", () => {
  it("accepts text format", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: { format: { type: "text" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_object format", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: { format: { type: "json_object" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts json_schema format with name, schema, strict", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
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

  it("rejects json_schema without name", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: { format: { type: "json_schema", schema: { type: "object" } } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects json_schema without schema", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: { format: { type: "json_schema", name: "answer" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown format type", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: { format: { type: "yaml" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects text as a free-form string", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      text: "free-form",
    });
    expect(result.success).toBe(false);
  });
});

describe("responseCreateRequestSchema — service_tier and safety_identifier", () => {
  it.each(["auto", "default", "flex", "priority"] as const)("accepts service_tier=%s", (tier) => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", service_tier: tier });
    expect(result.success).toBe(true);
  });

  it("rejects unknown service_tier", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", service_tier: "pro" });
    expect(result.success).toBe(false);
  });

  it("accepts a 1–64 char safety_identifier", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", safety_identifier: "u1" }).success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", safety_identifier: "u".repeat(64) })
        .success,
    ).toBe(true);
  });

  it("rejects empty safety_identifier", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x", safety_identifier: "" });
    expect(result.success).toBe(false);
  });

  it("rejects safety_identifier over 64 chars", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      safety_identifier: "u".repeat(65),
    });
    expect(result.success).toBe(false);
  });
});

describe("responseCreateRequestSchema — stream + background conflict", () => {
  it("rejects stream=true and background=true with param=background", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
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
      stream: true,
      background: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts stream=false with background=true (handler returns 422)", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      stream: false,
      background: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts neither stream nor background set", () => {
    const result = responseCreateRequestSchema.safeParse({ model: "x" });
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

  it("rejects empty model", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing model", () => {
    const result = responseCompactRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string input", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "x", input: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty array input", () => {
    const result = responseCompactRequestSchema.safeParse({ model: "x", input: [] });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const result = responseCompactRequestSchema.safeParse({
      model: "x",
      instructions: "nope",
    });
    expect(result.success).toBe(false);
  });
});
