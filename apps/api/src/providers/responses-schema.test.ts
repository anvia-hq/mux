import { describe, expect, it } from "vitest";
import { responseCreateRequestSchema } from "./responses-schema";

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
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
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
      input: [
        { type: "message", role: "tool", content: [{ type: "input_text", text: "hi" }] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects input message with wrong content shape", () => {
    const result = responseCreateRequestSchema.safeParse({
      model: "x",
      input: [
        { type: "message", role: "user", content: [{ type: "input_image", url: "x" }] },
      ],
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
      tools: [{ type: "function", function: { name: "lookup" } }],
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
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", temperature: -0.1 }).success,
    ).toBe(false);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", temperature: 2.5 }).success,
    ).toBe(false);
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
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", truncation: "auto" }).success,
    ).toBe(true);
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", truncation: "disabled" }).success,
    ).toBe(true);
  });

  it("rejects truncation with unknown value", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", truncation: "maybe" }).success,
    ).toBe(false);
  });

  it("accepts prompt as string or structured object", () => {
    expect(
      responseCreateRequestSchema.safeParse({ model: "x", prompt: "summarize" }).success,
    ).toBe(true);
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
