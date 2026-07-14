import { parseStatusCodeRanges, type StatusCodeRange } from "../../chat/relay/config";

export type EmbeddingsRelayConfig = {
  retryCount: number;
  retryStatusCodes: StatusCodeRange[];
  nonStreamTimeoutMs: number;
  maxRequestBodyBytes: number;
  rateLimitWindowSeconds: number;
  rateLimitTotal: number;
  rateLimitSuccess: number;
};

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new Error(`${name} must be an integer between ${range.min} and ${range.max}`);
  }
  return value;
}

export function readEmbeddingsRelayConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingsRelayConfig {
  const maxBodyMb = integerEnv(env, "EMBEDDINGS_MAX_REQUEST_BODY_MB", 128, {
    min: 1,
    max: 1024,
  });
  return {
    retryCount: integerEnv(env, "EMBEDDINGS_RETRY_COUNT", 2, { min: 0, max: 10 }),
    retryStatusCodes: parseStatusCodeRanges(
      env.EMBEDDINGS_RETRY_STATUS_CODES?.trim() || "408,409,425,429,500-599",
    ),
    nonStreamTimeoutMs: integerEnv(env, "EMBEDDINGS_NON_STREAM_TIMEOUT_MS", 120_000, {
      min: 1,
      max: 3_600_000,
    }),
    maxRequestBodyBytes: maxBodyMb * 1024 * 1024,
    rateLimitWindowSeconds: integerEnv(env, "EMBEDDINGS_RATE_LIMIT_WINDOW_SECONDS", 60, {
      min: 1,
      max: 86_400,
    }),
    rateLimitTotal: integerEnv(env, "EMBEDDINGS_RATE_LIMIT_TOTAL", 0, {
      min: 0,
      max: 10_000_000,
    }),
    rateLimitSuccess: integerEnv(env, "EMBEDDINGS_RATE_LIMIT_SUCCESS", 0, {
      min: 0,
      max: 10_000_000,
    }),
  };
}

export const embeddingsRelayConfig = readEmbeddingsRelayConfig();
