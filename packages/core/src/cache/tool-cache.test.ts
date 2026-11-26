import { describe, expect, test } from "bun:test";
import type { CanonicalTool, ToolCachePolicy, ToolExecutionResult } from "../types";
import { createMemoryRedisBackend } from "./testing/memory-redis-backend";
import { buildToolCacheKey, createToolCache } from "./tool-cache";

const textResult = (text: string, isError?: boolean): ToolExecutionResult => {
  const result: ToolExecutionResult = { content: [{ type: "text", text }] };

  if (isError !== undefined) {
    result.isError = isError;
  }

  return result;
};

describe("ToolCache", () => {
  test("always executes upstream when cache policy mode is off", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    let calls = 0;
    const policy: ToolCachePolicy = { mode: "off", ttlSeconds: 60 };

    const first = await cache.executeWithCache({
      toolId: "tool-1",
      schemaHash: "hash-1",
      args: { id: 1 },
      policy,
      execute: async () => {
        calls += 1;

        return textResult(`call-${calls}`);
      },
    });
    const second = await cache.executeWithCache({
      toolId: "tool-1",
      schemaHash: "hash-1",
      args: { id: 1 },
      policy,
      execute: async () => {
        calls += 1;

        return textResult(`call-${calls}`);
      },
    });

    expect(calls).toBe(2);
    expect(first.cacheStatus).toBe("disabled");
    expect(second.cacheStatus).toBe("disabled");
  });

  test("serves TTL hits with argument key-order invariance and busts on expiry, schema change, or scope change", async () => {
    let clock = 1_000_000;
    const backend = createMemoryRedisBackend(() => clock);
    const cache = createToolCache(backend, { now: () => clock });
    let calls = 0;
    const policy: ToolCachePolicy = { mode: "ttl", ttlSeconds: 30 };

    const run = async (args: Record<string, unknown>, schemaHash = "v1", scopeKey?: string) =>
      cache.executeWithCache({
        toolId: "tool-1",
        schemaHash,
        args,
        policy,
        scopeKey,
        execute: async () => {
          calls += 1;

          return textResult(`run-${calls}`);
        },
      });

    const first = await run({ a: 1, b: 2 });
    const second = await run({ b: 2, a: 1 });
    const schemaChanged = await run({ a: 1, b: 2 }, "v2");
    const scoped = await run({ a: 1, b: 2 }, "v1", "endpoint-b");

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.result).toEqual(first.result);
    expect(schemaChanged.cacheStatus).toBe("miss");
    expect(scoped.cacheStatus).toBe("miss");
    expect(calls).toBe(3);

    clock += 31_000;

    const expired = await run({ a: 1, b: 2 });

    expect(expired.cacheStatus).toBe("miss");
    expect(calls).toBe(4);
  });

  test("skips caching error results and payloads exceeding maxPayloadBytes", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    let calls = 0;
    const policy: ToolCachePolicy = { mode: "ttl", ttlSeconds: 60, maxPayloadBytes: 2048 };

    await cache.executeWithCache({
      toolId: "tool-err",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        calls += 1;

        return textResult("upstream failed", true);
      },
    });
    await cache.executeWithCache({
      toolId: "tool-err",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        calls += 1;

        return textResult("upstream failed", true);
      },
    });

    expect(calls).toBe(2);

    const oversized = "x".repeat(4000);
    let bigCalls = 0;

    await cache.executeWithCache({
      toolId: "tool-big",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        bigCalls += 1;

        return textResult(oversized);
      },
    });
    await cache.executeWithCache({
      toolId: "tool-big",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        bigCalls += 1;

        return textResult(oversized);
      },
    });

    expect(bigCalls).toBe(2);
  });

  test("coalesces concurrent identical misses via singleflight", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const policy: ToolCachePolicy = { mode: "ttl", ttlSeconds: 60 };

    const pending = Array.from({ length: 5 }, () =>
      cache.executeWithCache({
        toolId: "tool-sf",
        schemaHash: "v1",
        args: { query: "mux" },
        policy,
        execute: async () => {
          calls += 1;
          await gate;

          return textResult(`result-${calls}`);
        },
      }),
    );

    release();

    const outcomes = await Promise.all(pending);

    expect(calls).toBe(1);

    for (const outcome of outcomes) {
      expect(outcome.result).toEqual(textResult("result-1"));
    }
  });

  test("serves stale_while_revalidate immediately and refreshes in the background", async () => {
    let clock = 5_000_000;
    const backend = createMemoryRedisBackend(() => clock);
    const cache = createToolCache(backend, { now: () => clock });
    let calls = 0;
    const policy: ToolCachePolicy = {
      mode: "stale_while_revalidate",
      ttlSeconds: 10,
      staleSeconds: 20,
    };

    const run = async () =>
      cache.executeWithCache({
        toolId: "tool-swr",
        schemaHash: "v1",
        args: { id: "abc" },
        policy,
        execute: async () => {
          calls += 1;

          return textResult(`v${calls}`);
        },
      });

    const initial = await run();

    expect(initial.cacheStatus).toBe("miss");
    expect(initial.result).toEqual(textResult("v1"));

    clock += 15_000;

    const stale = await run();

    expect(stale.cacheStatus).toBe("stale");
    expect(stale.result).toEqual(textResult("v1"));

    await cache.flushPendingRevalidations();

    const refreshed = await run();

    expect(refreshed.cacheStatus).toBe("hit");
    expect(refreshed.result).toEqual(textResult("v2"));
    expect(calls).toBe(2);
  });

  test("respects bypass policy and invalidates entries by tool or custom tag", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    let calls = 0;
    const policy: ToolCachePolicy = {
      mode: "ttl",
      ttlSeconds: 300,
      tags: ["github:issues"],
      allowBypass: true,
    };

    const run = async (bypass = false) =>
      cache.executeWithCache({
        toolId: "tool-inv",
        schemaHash: "v1",
        args: { repo: "mux" },
        policy,
        bypass,
        execute: async () => {
          calls += 1;

          return textResult(`v${calls}`);
        },
      });

    await run();

    const bypassed = await run(true);

    expect(bypassed.cacheStatus).toBe("bypass");
    expect(bypassed.result).toEqual(textResult("v2"));

    await cache.invalidateTag("github:issues");

    const afterTagPurge = await run();

    expect(afterTagPurge.cacheStatus).toBe("miss");
    expect(afterTagPurge.result).toEqual(textResult("v3"));

    await cache.invalidateTool("tool-inv");

    const afterToolPurge = await run();

    expect(afterToolPurge.cacheStatus).toBe("miss");
    expect(afterToolPurge.result).toEqual(textResult("v4"));
  });

  test("caches and invalidates endpoint tool catalogs and recovers from corrupt Redis payloads", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    const catalog: CanonicalTool[] = [
      {
        id: "t1",
        sourceId: "s1",
        sourceSlug: "github",
        sourceKind: "mcp_remote",
        name: "list_issues",
        slug: "github__list_issues",
        description: "List issues",
        inputSchema: { type: "object", properties: {} },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
        cachePolicy: { mode: "ttl", ttlSeconds: 60, allowBypass: true },
        schemaHash: "abc123",
        enabled: true,
      },
    ];

    expect(await cache.getEndpointCatalog("ep-1")).toBeNull();

    await cache.setEndpointCatalog("ep-1", catalog, 120);
    expect(await cache.getEndpointCatalog("ep-1")).toEqual(catalog);

    await cache.invalidateEndpointCatalog("ep-1");
    expect(await cache.getEndpointCatalog("ep-1")).toBeNull();

    const key = buildToolCacheKey({
      toolId: "corrupt-tool",
      schemaHash: "v1",
      args: {},
    });

    await backend.setEx(key, "{invalid-json", 60);

    const recovered = await cache.executeWithCache({
      toolId: "corrupt-tool",
      schemaHash: "v1",
      args: {},
      policy: { mode: "ttl", ttlSeconds: 60 },
      execute: async () => textResult("fresh"),
    });

    expect(recovered.cacheStatus).toBe("miss");
    expect(recovered.result).toEqual(textResult("fresh"));
  });
});
