import { createHash } from "node:crypto";

const hasToJson = (value: object): value is { toJSON: () => unknown } =>
  "toJSON" in value && typeof value.toJSON === "function";

const serializeValue = (value: unknown, seen: Set<object>): string | undefined => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "null";
    }

    const normalized = Object.is(value, -0) ? 0 : value;

    return JSON.stringify(normalized);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    throw new TypeError("Cannot canonicalize BigInt values in JSON.");
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    throw new TypeError("Cannot canonicalize circular JSON structure.");
  }

  seen.add(value);

  try {
    if (hasToJson(value)) {
      const converted = value.toJSON();

      return serializeValue(converted, seen);
    }

    if (Array.isArray(value)) {
      const items: string[] = [];

      for (const element of value) {
        const serialized = serializeValue(element, seen);

        items.push(serialized === undefined ? "null" : serialized);
      }

      return `[${items.join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const pairs: string[] = [];

    for (const key of keys) {
      const serialized = serializeValue(record[key], seen);

      if (serialized !== undefined) {
        pairs.push(`${JSON.stringify(key)}:${serialized}`);
      }
    }

    return `{${pairs.join(",")}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalizeJson = (value: unknown): string => {
  const serialized = serializeValue(value, new Set());

  if (serialized === undefined) {
    return "null";
  }

  return serialized;
};

export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

export const computeSchemaHash = (inputSchema: Record<string, unknown>): string =>
  sha256Hex(canonicalizeJson(inputSchema));
