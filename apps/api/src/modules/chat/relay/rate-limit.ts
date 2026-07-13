import { redis } from "../../../utils/redis";
import type { ChatRelayConfig } from "./config";

export class ChatRateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "ChatRateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ChatRateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate limit service unavailable");
    this.name = "ChatRateLimitUnavailableError";
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

export function chatRateLimitEnabled(config: ChatRelayConfig): boolean {
  return config.rateLimitTotal > 0 || config.rateLimitSuccess > 0;
}

function windowInfo(config: ChatRelayConfig, nowMs: number) {
  const nowSeconds = Math.floor(nowMs / 1_000);
  const bucket = Math.floor(nowSeconds / config.rateLimitWindowSeconds);
  const retryAfterSeconds =
    config.rateLimitWindowSeconds - (nowSeconds % config.rateLimitWindowSeconds);
  return { bucket, retryAfterSeconds };
}

export async function checkChatRateLimit(
  apiKeyId: string,
  config: ChatRelayConfig,
  nowMs = Date.now(),
): Promise<void> {
  if (!chatRateLimitEnabled(config)) return;
  const { bucket, retryAfterSeconds } = windowInfo(config, nowMs);
  try {
    const result = await redis.eval(
      CHECK_SCRIPT,
      2,
      `chat_rate:total:${apiKeyId}:${bucket}`,
      `chat_rate:success:${apiKeyId}:${bucket}`,
      String(config.rateLimitSuccess),
      String(config.rateLimitTotal),
      String(config.rateLimitWindowSeconds + 1),
    );
    if (!Array.isArray(result) || (result[0] !== 1 && result[0] !== "1")) {
      throw new ChatRateLimitExceededError(retryAfterSeconds);
    }
  } catch (error) {
    if (error instanceof ChatRateLimitExceededError) throw error;
    throw new ChatRateLimitUnavailableError(error);
  }
}

export async function recordChatRateLimitSuccess(
  apiKeyId: string,
  config: ChatRelayConfig,
  nowMs = Date.now(),
): Promise<void> {
  if (config.rateLimitSuccess <= 0) return;
  const { bucket } = windowInfo(config, nowMs);
  try {
    const key = `chat_rate:success:${apiKeyId}:${bucket}`;
    const result = await redis
      .multi()
      .incr(key)
      .expire(key, config.rateLimitWindowSeconds + 1)
      .exec();
    if (!result || result.some(([error]) => error))
      throw new Error("rate limit transaction failed");
  } catch (error) {
    throw new ChatRateLimitUnavailableError(error);
  }
}
