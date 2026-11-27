import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTwelveDataClient } from "./index";

describe("twelvedata plugin manifest", () => {
  test("has valid structure, 6 core tools, and matching exported handlers", async () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "manifest.json"), "utf8"));

    expect(manifest.name).toBe("twelvedata");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.secrets).toEqual(["TWELVEDATA_API_KEY"]);
    expect(manifest.tools).toHaveLength(6);

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

describe("twelvedata client", () => {
  test("throws when TWELVEDATA_API_KEY is missing", async () => {
    const client = createTwelveDataClient();

    await expect(client.latestPrice({ symbol: "AAPL" }, { env: {} })).rejects.toThrow(
      "Missing TWELVEDATA_API_KEY secret.",
    );
  });

  test("throws when no instrument identifier is provided", async () => {
    const client = createTwelveDataClient();

    await expect(
      client.quote({}, { env: { TWELVEDATA_API_KEY: "td-test-key" } }),
    ).rejects.toThrow("At least one of symbol, figi, isin, or cusip is required.");
  });

  test("sends GET /time_series with apikey Authorization header and query params", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("Authorization") ?? "";

      return new Response(JSON.stringify({ status: "ok", values: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createTwelveDataClient(fakeFetch);
    const result = await client.timeSeries(
      { symbol: "AAPL", interval: "1day", outputsize: 30, prepost: true },
      { env: { TWELVEDATA_API_KEY: "td-test-key" } },
    );

    const parsed = new URL(capturedUrl);
    expect(parsed.pathname).toBe("/time_series");
    expect(parsed.searchParams.get("symbol")).toBe("AAPL");
    expect(parsed.searchParams.get("interval")).toBe("1day");
    expect(parsed.searchParams.get("outputsize")).toBe("30");
    expect(parsed.searchParams.get("prepost")).toBe("true");
    expect(capturedAuth).toBe("apikey td-test-key");
    expect(result).toEqual({ status: "ok", values: [] });
  });

  test("sends GET /market_movers/{market} without market in query params", async () => {
    let capturedUrl = "";

    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);

      return new Response(JSON.stringify({ status: "ok", values: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = createTwelveDataClient(fakeFetch);
    await client.marketMovers(
      { market: "stocks", direction: "gainers", outputsize: 10 },
      { env: { TWELVEDATA_API_KEY: "td-test-key" } },
    );

    const parsed = new URL(capturedUrl);
    expect(parsed.pathname).toBe("/market_movers/stocks");
    expect(parsed.searchParams.get("market")).toBeNull();
    expect(parsed.searchParams.get("direction")).toBe("gainers");
    expect(parsed.searchParams.get("outputsize")).toBe("10");
  });

  test("returns raw CSV text when format is CSV", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response("datetime;open;high;low;close;volume\n2026-01-01;1;2;1;2;100", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      })) as typeof fetch;

    const client = createTwelveDataClient(fakeFetch);
    const result = await client.timeSeriesCross(
      { base: "BTC", quote: "EUR", interval: "1h", format: "CSV" },
      { env: { TWELVEDATA_API_KEY: "td-test-key" } },
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("datetime;open;high;low;close;volume");
  });

  test("throws when Twelve Data returns status=error", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ code: 401, message: "Invalid API key.", status: "error" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const client = createTwelveDataClient(fakeFetch);

    await expect(
      client.endOfDayPrice({ symbol: "AAPL" }, { env: { TWELVEDATA_API_KEY: "bad" } }),
    ).rejects.toThrow("Invalid API key.");
  });
});
