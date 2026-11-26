import { describe, expect, test } from "bun:test";
import { buildToolSlug, parsePluginManifest } from "./manifest";

const createValidManifest = () => ({
  name: "stripe-helper",
  version: "1.0.0",
  description: "Custom Stripe lookup tools",
  entry: "./src/index.ts",
  secrets: ["STRIPE_API_KEY"],
  tools: [
    {
      name: "get_customer",
      description: "Fetch customer details by email",
      handler: "getCustomer",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: { email: { type: "string" } },
        required: ["email"],
      },
      cache: {
        mode: "ttl",
        ttlSeconds: 300,
        tags: ["stripe:customers"],
      },
    },
  ],
});

describe("parsePluginManifest", () => {
  test("parses valid manifest and applies safe defaults", () => {
    const parsed = parsePluginManifest(createValidManifest());

    expect(parsed.timeoutMs).toBe(10_000);
    expect(parsed.tools[0].destructive).toBe(false);
    expect(parsed.tools[0].idempotent).toBe(false);
    expect(parsed.tools[0].cache?.allowBypass).toBe(true);
    expect(buildToolSlug(parsed.name, parsed.tools[0].name)).toBe("stripe-helper__get_customer");
  });

  test("rejects traversal, URL schemes, drive prefixes, smuggling, and malformed entry paths", () => {
    const invalidEntries = [
      "../escape.ts",
      "sub/../../escape.ts",
      "/etc/passwd.ts",
      "./index.sh",
      "file:///etc/passwd.ts",
      "https://evil.com/pwn.mjs",
      "C:evil.ts",
      "index.ts?x=.ts",
      "index.ts#.ts",
      "%2e%2e/escape.ts",
      ".ts",
      "foo//bar.ts",
      "././index.ts",
    ];

    for (const entry of invalidEntries) {
      const manifest = { ...createValidManifest(), entry };

      expect(() => parsePluginManifest(manifest)).toThrow();
    }
  });

  test("rejects double-underscore slugs, reserved prototype handlers, duplicates, and non-object schemas", () => {
    const base = createValidManifest();
    const duplicateTools = { ...base, tools: [base.tools[0], base.tools[0]] };
    const duplicateSecrets = { ...base, secrets: ["STRIPE_API_KEY", "STRIPE_API_KEY"] };
    const badSchema = {
      ...base,
      tools: [{ ...base.tools[0], inputSchema: { type: "array" } }],
    };
    const doubleUnderscorePlugin = { ...base, name: "stripe__helper" };
    const doubleUnderscoreTool = {
      ...base,
      tools: [{ ...base.tools[0], name: "get__customer" }],
    };

    expect(() => parsePluginManifest(duplicateTools)).toThrow();
    expect(() => parsePluginManifest(duplicateSecrets)).toThrow();
    expect(() => parsePluginManifest(badSchema)).toThrow();
    expect(() => parsePluginManifest(doubleUnderscorePlugin)).toThrow();
    expect(() => parsePluginManifest(doubleUnderscoreTool)).toThrow();

    for (const handler of ["__proto__", "constructor", "prototype"]) {
      const reservedHandler = {
        ...base,
        tools: [{ ...base.tools[0], handler }],
      };

      expect(() => parsePluginManifest(reservedHandler)).toThrow();
    }
  });
});
