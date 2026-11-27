import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAlphaVantageClient } from "./index";

describe("alphavantage plugin manifest", () => {
  test("has valid structure, 12 core stock tools, and matching exported handlers", async () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "manifest.json"), "utf8"));

    expect(manifest.name).toBe("alphavantage");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.secrets).toEqual(["ALPHAVANTAGE_API_KEY"]);
    expect(manifest.tools).toHaveLength(12);

    const mod = await import("./index");
    const seenNames = new Set<string>();

    for (const tool of manifest.tools) {
      expect(seenNames.has(tool.name)).toBe(false);
      seenNames.add(tool.name);
      expect(tool.readOnly).toBe(true);
      expect(tool.idempotent).toBe(true);
      expect(tool.inputSchema?.type).toBe("object");
      expect(typeof mod[tool.handler as keyof typeof mod]).toBe("function");
    }
  });
});

describe("alphavantage client", () => {
  test("throws when ALPHAVANTAGE_API_KEY is missing", async () => {
    const client = createAlphaVantageClient();

    await expect(client.globalQuote({ symbol: "IBM" }, { env: {} })).rejects.toThrow(
      "Missing ALPHAVANTAGE_API_KEY secret.",
    );
  });

  test("builds query parameters and returns parsed JSON", async () => {
    const capturedUrls: string[] = [];
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      capturedUrls.push(String(input));

      return new Response(JSON.stringify({ "Global Quote": { "01. symbol": "IBM" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createAlphaVantageClient(fakeFetch);
    const result = await client.timeSeriesIntraday(
      { symbol: "IBM", interval: "5min", adjusted: false, outputsize: "compact" },
      { env: { ALPHAVANTAGE_API_KEY: "test-key" } },
    );

    expect(capturedUrls).toHaveLength(1);
    const parsedUrl = new URL(capturedUrls[0]);
    expect(parsedUrl.searchParams.get("function")).toBe("TIME_SERIES_INTRADAY");
    expect(parsedUrl.searchParams.get("symbol")).toBe("IBM");
    expect(parsedUrl.searchParams.get("interval")).toBe("5min");
    expect(parsedUrl.searchParams.get("adjusted")).toBe("false");
    expect(parsedUrl.searchParams.get("outputsize")).toBe("compact");
    expect(parsedUrl.searchParams.get("apikey")).toBe("test-key");
    expect(result).toEqual({ "Global Quote": { "01. symbol": "IBM" } });
  });

  test("returns raw CSV text when datatype is csv", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response("timestamp,open,high,low,close,volume\n2026-01-01,1,2,1,2,100", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      })) as typeof fetch;

    const client = createAlphaVantageClient(fakeFetch);
    const result = await client.timeSeriesDaily(
      { symbol: "IBM", datatype: "csv" },
      { env: { ALPHAVANTAGE_API_KEY: "test-key" } },
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("timestamp,open,high,low,close,volume");
  });

  test("throws on Alpha Vantage API error or rate-limit note", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ Note: "API rate limit reached." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const client = createAlphaVantageClient(fakeFetch);

    await expect(
      client.marketStatus({}, { env: { ALPHAVANTAGE_API_KEY: "test-key" } }),
    ).rejects.toThrow("Alpha Vantage API error: API rate limit reached.");
  });
});
