import { describe, expect, test } from "bun:test";
import type { CanonicalTool, ToolCachePolicy, ToolExecutionResult } from "../types";
import { createMemoryRedisBackend } from "./testing/memory-redis-backend";
import { buildToolCacheKey, createToolCache } from "./tool-cache";
import type { RedisBackend } from "./types";

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

  test("serves TTL hits with argument key-order invariance and isolates schema, scope, and unscoped keys", async () => {
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
    const explicitGlobalScope = await run({ a: 1, b: 2 }, "v1", "global");

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.result).toEqual(first.result);
    expect(schemaChanged.cacheStatus).toBe("miss");
    expect(explicitGlobalScope.cacheStatus).toBe("miss");
    expect(calls).toBe(3);

    clock += 31_000;

    const expired = await run({ a: 1, b: 2 });

    expect(expired.cacheStatus).toBe("miss");
    expect(calls).toBe(4);
  });

  test("skips caching error results, oversized payloads, and non-positive TTLs", async () => {
    const backend = createMemoryRedisBackend();
    const cache = createToolCache(backend);
    let errCalls = 0;
    const policy: ToolCachePolicy = { mode: "ttl", ttlSeconds: 60, maxPayloadBytes: 2048 };

    for (let i = 0; i < 2; i += 1) {
      await cache.executeWithCache({
        toolId: "tool-err",
        schemaHash: "v1",
        args: {},
        policy,
        execute: async () => {
          errCalls += 1;

          return textResult("upstream failed", true);
        },
      });
    }

    expect(errCalls).toBe(2);

    const oversized = "x".repeat(4000);
    let bigCalls = 0;

    for (let i = 0; i < 2; i += 1) {
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
    }

    expect(bigCalls).toBe(2);

    let zeroTtlCalls = 0;

    for (let i = 0; i < 2; i += 1) {
      await cache.executeWithCache({
        toolId: "tool-zero-ttl",
        schemaHash: "v1",
        args: {},
        policy: { mode: "ttl", ttlSeconds: 0 },
        execute: async () => {
          zeroTtlCalls += 1;

          return textResult("ok");
        },
      });
    }

    expect(zeroTtlCalls).toBe(2);
  });

  test("coalesces concurrent identical misses via singleflight and recovers from sync throws and async rejections", async () => {
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

    let syncAttempts = 0;

    await expect(
      cache.executeWithCache({
        toolId: "tool-sync-throw",
        schemaHash: "v1",
        args: {},
        policy,
        execute: () => {
          syncAttempts += 1;

          throw new Error("sync boom");
        },
      }),
    ).rejects.toThrow("sync boom");

    const recoveredFromSync = await cache.executeWithCache({
      toolId: "tool-sync-throw",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        syncAttempts += 1;

        return textResult("recovered-sync");
      },
    });

    expect(syncAttempts).toBe(2);
    expect(recoveredFromSync.result).toEqual(textResult("recovered-sync"));

    let asyncAttempts = 0;

    await expect(
      cache.executeWithCache({
        toolId: "tool-async-reject",
        schemaHash: "v1",
        args: {},
        policy,
        execute: async () => {
          asyncAttempts += 1;

          throw new Error("async boom");
        },
      }),
    ).rejects.toThrow("async boom");

    const recoveredFromAsync = await cache.executeWithCache({
      toolId: "tool-async-reject",
      schemaHash: "v1",
      args: {},
      policy,
      execute: async () => {
        asyncAttempts += 1;

        return textResult("recovered-async");
      },
    });

    expect(asyncAttempts).toBe(2);
    expect(recoveredFromAsync.result).toEqual(textResult("recovered-async"));
  });

  test("serves stale_while_revalidate immediately, deduplicates concurrent refreshes, and recovers from background errors", async () => {
    let clock = 5_000_000;
    const backend = createMemoryRedisBackend(() => clock);
    const backgroundErrors: string[] = [];
    const cache = createToolCache(backend, {
      now: () => clock,
      onBackgroundError: (_error, key) => {
        backgroundErrors.push(key);
        throw new Error("listener error must not crash revalidation");
      },
    });
    let calls = 0;
    const policy: ToolCachePolicy = {
      mode: "stale_while_revalidate",
      ttlSeconds: 10,
      staleSeconds: 20,
    };

    const initial = await cache.executeWithCache({
      toolId: "tool-swr",
      schemaHash: "v1",
      args: { id: "abc" },
      policy,
      execute: async () => {
        calls += 1;

        return textResult(`v${calls}`);
      },
    });

    expect(initial.cacheStatus).toBe("miss");
    expect(initial.result).toEqual(textResult("v1"));

    clock += 15_000;

    const failedStale = await cache.executeWithCache({
      toolId: "tool-swr",
      schemaHash: "v1",
      args: { id: "abc" },
      policy,
      execute: () => {
        throw new Error("sync revalidation failure");
      },
    });

    expect(failedStale.cacheStatus).toBe("stale");
    await cache.flushPendingRevalidations();
    expect(backgroundErrors.length).toBe(1);

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    const concurrentStale = await Promise.all([
      cache.executeWithCache({
        toolId: "tool-swr",
        schemaHash: "v1",
        args: { id: "abc" },
        policy,
        execute: async () => {
          calls += 1;
          await refreshGate;

          return textResult(`v${calls}`);
        },
      }),
      cache.executeWithCache({
        toolId: "tool-swr",
        schemaHash: "v1",
        args: { id: "abc" },
        policy,
        execute: async () => {
          calls += 1;
          await refreshGate;

          return textResult(`v${calls}`);
        },
      }),
    ]);

    expect(concurrentStale[0].cacheStatus).toBe("stale");
    expect(concurrentStale[1].cacheStatus).toBe("stale");

    releaseRefresh();
    await cache.flushPendingRevalidations();

    const refreshed = await cache.executeWithCache({
      toolId: "tool-swr",
      schemaHash: "v1",
      args: { id: "abc" },
      policy,
      execute: async () => {
        calls += 1;

        return textResult(`v${calls}`);
      },
    });

    expect(refreshed.cacheStatus).toBe("hit");
    expect(refreshed.result).toEqual(textResult("v2"));
    expect(calls).toBe(2);
  });

  test("enforces allowBypass policy and preserves longer tag TTLs across mixed-TTL writes", async () => {
    let clock = 10_000_000;
    const backend = createMemoryRedisBackend(() => clock);
    const cache = createToolCache(backend, { now: () => clock });
    let calls = 0;

    const noBypassPolicy: ToolCachePolicy = {
      mode: "ttl",
      ttlSeconds: 300,
      allowBypass: false,
    };

    await cache.executeWithCache({
      toolId: "tool-no-bypass",
      schemaHash: "v1",
      args: { id: 1 },
      policy: noBypassPolicy,
      execute: async () => {
        calls += 1;

        return textResult(`v${calls}`);
      },
    });

    const ignoredBypass = await cache.executeWithCache({
      toolId: "tool-no-bypass",
      schemaHash: "v1",
      args: { id: 1 },
      policy: noBypassPolicy,
      bypass: true,
      execute: async () => {
        calls += 1;

        return textResult(`v${calls}`);
      },
    });

    expect(ignoredBypass.cacheStatus).toBe("hit");
    expect(calls).toBe(1);

    let bypassCalls = 0;
    const allowBypassPolicy: ToolCachePolicy = { mode: "ttl", ttlSeconds: 300, allowBypass: true };

    await cache.executeWithCache({
      toolId: "tool-bypass",
      schemaHash: "v1",
      args: { id: 1 },
      policy: allowBypassPolicy,
      execute: async () => {
        bypassCalls += 1;

        return textResult(`b${bypassCalls}`);
      },
    });

    const bypassed = await cache.executeWithCache({
      toolId: "tool-bypass",
      schemaHash: "v1",
      args: { id: 1 },
      policy: allowBypassPolicy,
      bypass: true,
      execute: async () => {
        bypassCalls += 1;

        return textResult(`b${bypassCalls}`);
      },
    });

    expect(bypassed.cacheStatus).toBe("bypass");
    expect(bypassed.result).toEqual(textResult("b2"));
    expect(await cache.invalidateTool("tool-bypass")).toBe(1);

    await cache.executeWithCache({
      toolId: "tool-long",
      schemaHash: "v1",
      args: { id: "long" },
      policy: { mode: "ttl", ttlSeconds: 86_400, tags: ["shared-tag"] },
      execute: async () => textResult("long-entry"),
    });
    await cache.executeWithCache({
      toolId: "tool-short",
      schemaHash: "v1",
      args: { id: "short" },
      policy: { mode: "ttl", ttlSeconds: 60, tags: ["shared-tag"] },
      execute: async () => textResult("short-entry"),
    });

    clock += 4_000_000;

    const deleted = await cache.invalidateTag("shared-tag");

    expect(deleted).toBe(1);

    let afterPurgeCalls = 0;
    const refetched = await cache.executeWithCache({
      toolId: "tool-long",
      schemaHash: "v1",
      args: { id: "long" },
      policy: { mode: "ttl", ttlSeconds: 86_400, tags: ["shared-tag"] },
      execute: async () => {
        afterPurgeCalls += 1;

        return textResult("long-refetched");
      },
    });

    expect(refetched.cacheStatus).toBe("miss");
    expect(afterPurgeCalls).toBe(1);
  });

  test("fails open on Redis read/write errors without discarding upstream results", async () => {
    const cacheErrors: string[] = [];
    const failingBackend: RedisBackend = {
      get: async () => {
        throw new Error("redis read down");
      },
      setEx: async () => {
        throw new Error("redis write down");
      },
      del: async () => 0,
      sadd: async () => 0,
      smembers: async () => [],
      expire: async () => {},
      ttl: async () => -2,
    };
    const cache = createToolCache(failingBackend, {
      onCacheError: (_err, key) => {
        cacheErrors.push(key);
      },
    });

    const outcome = await cache.executeWithCache({
      toolId: "tool-resilient",
      schemaHash: "v1",
      args: { a: 1 },
      policy: { mode: "ttl", ttlSeconds: 60 },
      execute: async () => textResult("upstream-ok"),
    });

    expect(outcome.cacheStatus).toBe("miss");
    expect(outcome.result).toEqual(textResult("upstream-ok"));
    expect(cacheErrors.length).toBe(2);
    expect(await cache.getEndpointCatalog("ep-down")).toBeNull();
  });

  test("caches and invalidates endpoint tool catalogs and recovers from corrupt payloads", async () => {
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
        cachePolicy: { mode: "off", ttlSeconds: 0, allowBypass: true },
        schemaHash: "abc123",
        enabled: true,
      },
    ];

    expect(await cache.getEndpointCatalog("ep-1")).toBeNull();

    await cache.setEndpointCatalog("ep-1", catalog, 120);
    expect(await cache.getEndpointCatalog("ep-1")).toEqual(catalog);

    await backend.setEx("mux:catalog:ep-corrupt", "{bad-json", 60);
    expect(await cache.getEndpointCatalog("ep-corrupt")).toBeNull();

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
