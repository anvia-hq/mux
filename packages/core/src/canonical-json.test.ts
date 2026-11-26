import { describe, expect, test } from "bun:test";
import { canonicalizeJson, computeSchemaHash } from "./canonical-json";

describe("canonicalizeJson", () => {
  test("produces identical output regardless of nested object key order", () => {
    const first = { z: 1, a: { d: true, c: [3, 2, 1] }, m: "hello" };
    const second = { m: "hello", a: { c: [3, 2, 1], d: true }, z: 1 };

    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second));
  });

  test("preserves array order and handles undefined, non-finite numbers, and toJSON", () => {
    const input = {
      arr: [1, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0],
      omitted: undefined,
      date: new Date("2026-01-02T03:04:05.000Z"),
    };

    expect(canonicalizeJson(input)).toBe(
      '{"arr":[1,null,null,null,0],"date":"2026-01-02T03:04:05.000Z"}',
    );
  });

  test("rejects circular references including self-returning toJSON while permitting shared acyclic references", () => {
    const shared = { id: 1 };

    expect(canonicalizeJson({ first: shared, second: shared })).toBe(
      '{"first":{"id":1},"second":{"id":1}}',
    );

    const cyclic: Record<string, unknown> = {};

    cyclic.self = cyclic;

    const cyclicToJson = {
      toJSON() {
        return this;
      },
    };

    expect(() => canonicalizeJson(cyclic)).toThrow(TypeError);
    expect(() => canonicalizeJson(cyclicToJson)).toThrow(TypeError);
  });

  test("computeSchemaHash changes when schema structure changes and ignores key order", () => {
    const schemaA = {
      type: "object",
      required: ["email"],
      properties: { email: { type: "string" } },
    };
    const schemaB = {
      properties: { email: { type: "string" } },
      type: "object",
      required: ["email"],
    };
    const schemaC = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    };

    expect(computeSchemaHash(schemaA)).toBe(computeSchemaHash(schemaB));
    expect(computeSchemaHash(schemaA)).not.toBe(computeSchemaHash(schemaC));
  });
});
