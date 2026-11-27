import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTavilyClient } from "./index";

describe("tavily plugin manifest", () => {
  test("has valid structure, 6 core tools, and matching exported handlers", async () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "manifest.json"), "utf8"));

    expect(manifest.name).toBe("tavily");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.secrets).toEqual(["TAVILY_API_KEY"]);
    expect(manifest.tools).toHaveLength(6);

    const mod = await import("./index");
    const seenNames = new Set<string>();

    for (const tool of manifest.tools) {
      expect(seenNames.has(tool.name)).toBe(false);
      seenNames.add(tool.name);
      expect(tool.inputSchema?.type).toBe("object");
      expect(typeof mod[tool.handler as keyof typeof mod]).toBe("function");
    }
  });
});

describe("tavily client", () => {
  test("throws when TAVILY_API_KEY is missing", async () => {
    const client = createTavilyClient();

    await expect(client.tavilySearch({ query: "openai" }, { env: {} })).rejects.toThrow(
      "Missing TAVILY_API_KEY secret.",
    );
  });

  test("sends POST /search with Bearer auth and JSON body", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    let capturedBody = "";

    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("Authorization") ?? "";
      capturedBody = typeof init?.body === "string" ? init.body : "";

      return new Response(JSON.stringify({ query: "nvda", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createTavilyClient(fakeFetch);
    const result = await client.tavilySearch(
      { query: "nvda", topic: "finance", max_results: 5 },
      { env: { TAVILY_API_KEY: "tvly-test-key" } },
    );

    expect(capturedUrl).toBe("https://api.tavily.com/search");
    expect(capturedAuth).toBe("Bearer tvly-test-key");
    expect(JSON.parse(capturedBody)).toEqual({
      query: "nvda",
      topic: "finance",
      max_results: 5,
    });
    expect(result).toEqual({ query: "nvda", results: [] });
  });

  test("sends GET /research/{request_id} with encoded ID and optional include_usage", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "";

      return new Response(JSON.stringify({ request_id: "req-123", status: "completed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createTavilyClient(fakeFetch);
    const result = await client.tavilyResearchGet(
      { request_id: "req-123", include_usage: true },
      { env: { TAVILY_API_KEY: "tvly-test-key" } },
    );

    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).toBe("https://api.tavily.com/research/req-123?include_usage=true");
    expect(result).toEqual({ request_id: "req-123", status: "completed" });
  });

  test("forces stream=false on tavilyResearch", async () => {
    let capturedBody = "";

    const fakeFetch: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";

      return new Response(JSON.stringify({ request_id: "req-456", status: "pending" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createTavilyClient(fakeFetch);
    const result = await client.tavilyResearch(
      { input: "AI market trends", model: "mini" },
      { env: { TAVILY_API_KEY: "tvly-test-key" } },
    );

    expect(JSON.parse(capturedBody)).toEqual({
      input: "AI market trends",
      model: "mini",
      stream: false,
    });
    expect(result).toEqual({ request_id: "req-456", status: "pending" });
  });

  test("throws structured error detail on non-OK HTTP responses", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ detail: { error: "Invalid API key." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const client = createTavilyClient(fakeFetch);

    await expect(
      client.tavilyMap({ url: "https://example.com" }, { env: { TAVILY_API_KEY: "bad" } }),
    ).rejects.toThrow("Invalid API key.");
  });
});
