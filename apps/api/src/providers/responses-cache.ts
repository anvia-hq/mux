/**
 * Opt-in Redis cache for the local gateway's `/v1/responses/:id` retrieve
 * path. OpenAI already caches server-side, so this is primarily useful for
 * self-hosted upstreams (Azure, etc.) that do not.
 *
 * Disabled by default. Set `MUX_RESPONSES_CACHE=1` to enable, and
 * `MUX_RESPONSES_CACHE_TTL_SECONDS` to override the 300s default TTL.
 *
 * Invalidation: TTL-only. POST /v1/responses/:id/cancel and
 * DELETE /v1/responses/:id do not evict the cache; staleness is bounded by
 * MUX_RESPONSES_CACHE_TTL_SECONDS. Acceptable because upstream responses
 * are immutable post-creation and the cache stores the body verbatim.
 */

import type { ResponseObject } from "./types";
import { redis } from "../utils/redis";

const DEFAULT_TTL_SECONDS = 300;

let cachedEnabled: boolean | undefined;
let cachedTtlSeconds: number | undefined;

export function isResponsesCacheEnabled(): boolean {
  if (cachedEnabled === undefined) {
    cachedEnabled = process.env.MUX_RESPONSES_CACHE === "1";
  }
  return cachedEnabled;
}

export function getResponsesCacheTtlSeconds(): number {
  if (cachedTtlSeconds === undefined) {
    const raw = process.env.MUX_RESPONSES_CACHE_TTL_SECONDS;
    if (raw === undefined || raw === "") {
      cachedTtlSeconds = DEFAULT_TTL_SECONDS;
    } else {
      const parsed = Number.parseInt(raw, 10);
      cachedTtlSeconds = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TTL_SECONDS;
    }
  }
  return cachedTtlSeconds;
}

export function _resetResponsesCacheForTests(): void {
  cachedEnabled = undefined;
  cachedTtlSeconds = undefined;
}

export function buildResponsesCacheKey(apiKeyId: string, provider: string, id: string): string {
  return `${apiKeyId}:${provider}:${id}`;
}

export async function readCachedResponse(
  apiKeyId: string,
  provider: string,
  id: string,
): Promise<ResponseObject | null> {
  try {
    const raw = await redis.get(buildResponsesCacheKey(apiKeyId, provider, id));
    if (!raw) return null;
    return JSON.parse(raw) as ResponseObject;
  } catch (error) {
    console.warn("Failed to read cached response:", error);
    return null;
  }
}

export async function writeCachedResponse(
  apiKeyId: string,
  provider: string,
  id: string,
  response: ResponseObject,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.set(
      buildResponsesCacheKey(apiKeyId, provider, id),
      JSON.stringify(response),
      "EX",
      ttlSeconds,
    );
  } catch (error) {
    console.warn("Failed to write cached response:", error);
  }
}
