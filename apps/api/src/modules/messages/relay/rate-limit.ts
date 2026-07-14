import { redis } from "../../../utils/redis";
import type { MessagesRelayConfig } from "./config";

export class MessagesRateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "MessagesRateLimitExceededError";
  }
}

export class MessagesRateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate limit service unavailable");
    this.name = "MessagesRateLimitUnavailableError";
    this.cause = cause;
  }
}

const CHECK_SCRIPT = `
local successLimit = tonumber(ARGV[1])
local totalLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local successes = tonumber(redis.call('GET', KEYS[2]) or '0')
if successLimit > 0 and successes >= successLimit then return {0, 'success'} end
if totalLimit > 0 then
  local total = redis.call('INCR', KEYS[1])
  if total == 1 then redis.call('EXPIRE', KEYS[1], ttl) end
  if total > totalLimit then return {0, 'total'} end
end
return {1, 'ok'}
`;

function windowInfo(config: MessagesRelayConfig, nowMs: number) {
  const seconds = Math.floor(nowMs / 1_000);
  return {
    bucket: Math.floor(seconds / config.rateLimitWindowSeconds),
    retryAfterSeconds: config.rateLimitWindowSeconds - (seconds % config.rateLimitWindowSeconds),
  };
}

export async function checkMessagesRateLimit(
  apiKeyId: string,
  config: MessagesRelayConfig,
  nowMs = Date.now(),
): Promise<void> {
  if (config.rateLimitTotal <= 0 && config.rateLimitSuccess <= 0) return;
  const { bucket, retryAfterSeconds } = windowInfo(config, nowMs);
  try {
    const result = await redis.eval(
      CHECK_SCRIPT,
      2,
      `messages_rate:total:${apiKeyId}:${bucket}`,
      `messages_rate:success:${apiKeyId}:${bucket}`,
      String(config.rateLimitSuccess),
      String(config.rateLimitTotal),
      String(config.rateLimitWindowSeconds + 1),
    );
    if (!Array.isArray(result) || (result[0] !== 1 && result[0] !== "1")) {
      throw new MessagesRateLimitExceededError(retryAfterSeconds);
    }
  } catch (error) {
    if (error instanceof MessagesRateLimitExceededError) throw error;
    throw new MessagesRateLimitUnavailableError(error);
  }
}

export async function recordMessagesRateLimitSuccess(
  apiKeyId: string,
  config: MessagesRelayConfig,
  nowMs = Date.now(),
): Promise<void> {
  if (config.rateLimitSuccess <= 0) return;
  const { bucket } = windowInfo(config, nowMs);
  try {
    const key = `messages_rate:success:${apiKeyId}:${bucket}`;
    const result = await redis
      .multi()
      .incr(key)
      .expire(key, config.rateLimitWindowSeconds + 1)
      .exec();
    if (!result || result.some(([error]) => error)) {
      throw new Error("rate limit transaction failed");
    }
  } catch (error) {
    throw new MessagesRateLimitUnavailableError(error);
  }
}
