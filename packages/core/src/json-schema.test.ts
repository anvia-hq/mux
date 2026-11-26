import { describe, expect, test } from "bun:test";
import { validateAgainstJsonSchema } from "./json-schema";

describe("validateAgainstJsonSchema", () => {
  test("validates nested objects, required properties, bounds, enums, and additionalProperties", () => {
    const schema = {
      type: "object",
      required: ["email", "limit"],
      additionalProperties: false,
      properties: {
        email: { type: "string", minLength: 3 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        status: { type: "string", enum: ["open", "closed"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 3 },
      },
    };

    expect(
      validateAgainstJsonSchema(
        { email: "a@b.c", limit: 10, status: "open", tags: ["bug"] },
        schema,
      ),
    ).toEqual({ valid: true, errors: [] });

    const invalid = validateAgainstJsonSchema(
      { email: "a", limit: 1.5, status: "unknown", extra: true, tags: ["a", "b", "c", "d"] },
      schema,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThanOrEqual(4);

    const missingRequired = validateAgainstJsonSchema({ email: "a@b.c" }, schema);

    expect(missingRequired.valid).toBe(false);
  });
});
