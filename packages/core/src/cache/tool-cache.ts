import { Buffer } from "node:buffer";
import { z } from "zod";
import { canonicalizeJson, sha256Hex } from "../canonical-json";
import type { CanonicalTool, ToolCachePolicy, ToolExecutionResult } from "../types";
import { toolCachePolicySchema } from "./schema";
import type {
  BuildToolCacheKeyInput,
  ExecuteWithCacheInput,
  ExecuteWithCacheOutput,
  RedisBackend,
  ToolCache,
  ToolCacheOptions,
} from "./types";

const DEFAULT_KEY_PREFIX = "mux";
const DEFAULT_MAX_PAYLOAD_BYTES = 262_144;
const DEFAULT_CATALOG_TTL_SECONDS = 300;
const MIN_TAG_TTL_SECONDS = 3600;

const toolContentBlockSchema = z.object({
  type: z.enum(["text", "image", "resource"]),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  uri: z.string().optional(),
});

const toolExecutionResultSchema = z.object({
  content: z.array(toolContentBlockSchema),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});

const storedCacheEnvelopeSchema = z.object({
  result: toolExecutionResultSchema,
  storedAtMs: z.number(),
  freshUntilMs: z.number(),
  staleUntilMs: z.number(),
});

const catalogCachePolicySchema = toolCachePolicySchema.extend({
  ttlSeconds: z.number().int().min(0).max(86_400).default(60),
});

const canonicalToolSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceSlug: z.string(),
  sourceKind: z.enum(["mcp_remote", "plugin_code"]),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean().optional(),
  }),
  cachePolicy: catalogCachePolicySchema,
  schemaHash: z.string(),
  enabled: z.boolean(),
});

const canonicalToolListSchema = z.array(canonicalToolSchema);

type StoredCacheEnvelope = z.infer<typeof storedCacheEnvelopeSchema>;

const parseEnvelope = (raw: string): StoredCacheEnvelope | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = storedCacheEnvelopeSchema.safeParse(parsed);

    if (!result.success) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
};

const normalizePositiveInt = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const floored = Math.floor(value);

  if (floored < 1) {
    return null;
  }

  return floored;
};

export const buildToolCacheKey = (input: BuildToolCacheKeyInput): string => {
  const prefix = input.prefix ?? DEFAULT_KEY_PREFIX;
  const scopeRaw = input.scopeKey === undefined ? "global" : `scope:${input.scopeKey}`;
  const scopeHash = sha256Hex(scopeRaw).slice(0, 16);
  const argsHash = sha256Hex(canonicalizeJson(input.args));

  return `${prefix}:tool:${input.toolId}:${input.schemaHash}:${scopeHash}:${argsHash}`;
};

export const createToolCache = (
  backend: RedisBackend,
  options: ToolCacheOptions = {},
): ToolCache => {
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const defaultMaxPayloadBytes = options.defaultMaxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const defaultCatalogTtlSeconds = options.defaultCatalogTtlSeconds ?? DEFAULT_CATALOG_TTL_SECONDS;
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<ToolExecutionResult>>();
  const revalidating = new Map<string, Promise<void>>();

  const toolTagKey = (toolId: string): string => `${keyPrefix}:tag:tool:${toolId}`;
  const customTagKey = (tag: string): string => `${keyPrefix}:tag:custom:${tag}`;
  const catalogKey = (endpointId: string): string => `${keyPrefix}:catalog:${endpointId}`;

  const invokeErrorCallback = (
    handler: ((error: unknown, cacheKey: string) => void) | undefined,
    error: unknown,
    cacheKey: string,
  ): void => {
    if (!handler) {
      return;
    }

    try {
      handler(error, cacheKey);
    } catch {
      void error;
    }
  };

  const reportBackgroundError = (error: unknown, cacheKey: string): void => {
    invokeErrorCallback(options.onBackgroundError, error, cacheKey);
  };

  const reportCacheError = (error: unknown, cacheKey: string): void => {
    invokeErrorCallback(options.onCacheError ?? options.onBackgroundError, error, cacheKey);
  };

  const computeRedisTtlSeconds = (policy: ToolCachePolicy): number | null => {
    const ttl = normalizePositiveInt(policy.ttlSeconds);

    if (ttl === null) {
      return null;
    }

    if (policy.mode === "stale_while_revalidate") {
      const rawStale = policy.staleSeconds ?? ttl;
      const staleWindow = Number.isFinite(rawStale) ? Math.max(0, Math.floor(rawStale)) : 0;

      return ttl + staleWindow;
    }

    return ttl;
  };

  const safeGet = async (key: string): Promise<string | null> => {
    try {
      return await backend.get(key);
    } catch (error) {
      reportCacheError(error, key);

      return null;
    }
  };

  const writeEntry = async (
    cacheKey: string,
    toolId: string,
    policy: ToolCachePolicy,
    result: ToolExecutionResult,
  ): Promise<void> => {
    if (result.isError) {
      return;
    }

    const ttlSeconds = normalizePositiveInt(policy.ttlSeconds);
    const redisTtlSeconds = computeRedisTtlSeconds(policy);

    if (ttlSeconds === null || redisTtlSeconds === null) {
      return;
    }

    const storedAtMs = now();
    const freshUntilMs = storedAtMs + ttlSeconds * 1000;
    const staleWindow = policy.mode === "stale_while_revalidate" ? redisTtlSeconds - ttlSeconds : 0;
    const staleUntilMs = freshUntilMs + staleWindow * 1000;
    const envelope: StoredCacheEnvelope = {
      result,
      storedAtMs,
      freshUntilMs,
      staleUntilMs,
    };

    try {
      const serialized = JSON.stringify(envelope);
      const maxBytes = policy.maxPayloadBytes ?? defaultMaxPayloadBytes;

      if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        return;
      }

      await backend.setEx(cacheKey, serialized, redisTtlSeconds);

      const tagKeys = [toolTagKey(toolId)];

      if (policy.tags) {
        for (const tag of policy.tags) {
          tagKeys.push(customTagKey(tag));
        }
      }

      const desiredTagTtl = Math.max(redisTtlSeconds + 60, MIN_TAG_TTL_SECONDS);

      for (const tagKey of tagKeys) {
        await backend.sadd(tagKey, [cacheKey]);

        const currentTtl = await backend.ttl(tagKey);

        if (currentTtl < 0 || desiredTagTtl > currentTtl) {
          await backend.expire(tagKey, desiredTagTtl);
        }
      }
    } catch (error) {
      reportCacheError(error, cacheKey);
    }
  };

  const triggerRevalidation = (cacheKey: string, input: ExecuteWithCacheInput): void => {
    if (revalidating.has(cacheKey)) {
      return;
    }

    const task = Promise.resolve()
      .then(async () => {
        const freshResult = await input.execute();

        await writeEntry(cacheKey, input.toolId, input.policy, freshResult);
      })
      .catch((error: unknown) => {
        reportBackgroundError(error, cacheKey);
      })
      .finally(() => {
        if (revalidating.get(cacheKey) === task) {
          revalidating.delete(cacheKey);
        }
      });

    revalidating.set(cacheKey, task);
  };

  const executeWithCache = async (
    input: ExecuteWithCacheInput,
  ): Promise<ExecuteWithCacheOutput> => {
    if (input.policy.mode === "off") {
      const result = await input.execute();

      return { result, cacheStatus: "disabled" };
    }

    const cacheKey = buildToolCacheKey({
      prefix: keyPrefix,
      toolId: input.toolId,
      schemaHash: input.schemaHash,
      args: input.args,
      scopeKey: input.scopeKey,
    });
    const allowBypass = input.policy.allowBypass !== false;

    if (input.bypass && allowBypass) {
      const result = await input.execute();

      await writeEntry(cacheKey, input.toolId, input.policy, result);

      return { result, cacheStatus: "bypass", cacheKey };
    }

    const cachedRaw = await safeGet(cacheKey);

    if (cachedRaw !== null) {
      const envelope = parseEnvelope(cachedRaw);

      if (envelope !== null) {
        const currentMs = now();

        if (currentMs < envelope.freshUntilMs) {
          return { result: envelope.result, cacheStatus: "hit", cacheKey };
        }

        if (input.policy.mode === "stale_while_revalidate" && currentMs < envelope.staleUntilMs) {
          triggerRevalidation(cacheKey, input);

          return { result: envelope.result, cacheStatus: "stale", cacheKey };
        }
      }
    }

    const existingFlight = inFlight.get(cacheKey);

    if (existingFlight) {
      const result = await existingFlight;

      return { result, cacheStatus: "miss", cacheKey };
    }

    const flightPromise = Promise.resolve()
      .then(async () => {
        const result = await input.execute();

        await writeEntry(cacheKey, input.toolId, input.policy, result);

        return result;
      })
      .finally(() => {
        if (inFlight.get(cacheKey) === flightPromise) {
          inFlight.delete(cacheKey);
        }
      });

    inFlight.set(cacheKey, flightPromise);

    const result = await flightPromise;

    return { result, cacheStatus: "miss", cacheKey };
  };

  const invalidateByTagKey = async (tagKey: string): Promise<number> => {
    const members = await backend.smembers(tagKey);
    const deletedEntries = members.length > 0 ? await backend.del(members) : 0;

    await backend.del([tagKey]);

    return deletedEntries;
  };

  const invalidateTool = async (toolId: string): Promise<number> =>
    invalidateByTagKey(toolTagKey(toolId));

  const invalidateTag = async (tag: string): Promise<number> =>
    invalidateByTagKey(customTagKey(tag));

  const getEndpointCatalog = async (endpointId: string): Promise<CanonicalTool[] | null> => {
    const key = catalogKey(endpointId);
    const raw = await safeGet(key);

    if (raw === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const result = canonicalToolListSchema.safeParse(parsed);

      if (!result.success) {
        return null;
      }

      return result.data;
    } catch {
      return null;
    }
  };

  const setEndpointCatalog = async (
    endpointId: string,
    tools: CanonicalTool[],
    ttlSeconds: number = defaultCatalogTtlSeconds,
  ): Promise<void> => {
    const normalizedTtl = normalizePositiveInt(ttlSeconds);

    if (normalizedTtl === null) {
      return;
    }

    const key = catalogKey(endpointId);

    try {
      await backend.setEx(key, JSON.stringify(tools), normalizedTtl);
    } catch (error) {
      reportCacheError(error, key);
    }
  };

  const invalidateEndpointCatalog = async (endpointId: string): Promise<number> =>
    backend.del([catalogKey(endpointId)]);

  const flushPendingRevalidations = async (): Promise<void> => {
    await Promise.all(revalidating.values());
  };

  return {
    executeWithCache,
    invalidateTool,
    invalidateTag,
    getEndpointCatalog,
    setEndpointCatalog,
    invalidateEndpointCatalog,
    flushPendingRevalidations,
  };
};
