import { parseStatusCodeRanges, type StatusCodeRange } from "../../chat/relay/config";

export type ResponsesRelayConfig = {
  retryCount: number;
  retryStatusCodes: StatusCodeRange[];
  firstByteTimeoutMs: number;
  streamIdleTimeoutMs: number;
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

export function readResponsesRelayConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResponsesRelayConfig {
  const maxBodyMb = integerEnv(env, "RESPONSES_MAX_REQUEST_BODY_MB", 128, {
    min: 1,
    max: 1024,
  });
  return {
    retryCount: integerEnv(env, "RESPONSES_RETRY_COUNT", 2, { min: 0, max: 10 }),
    retryStatusCodes: parseStatusCodeRanges(
      env.RESPONSES_RETRY_STATUS_CODES?.trim() || "408,409,425,429,500-599",
    ),
    firstByteTimeoutMs: integerEnv(env, "RESPONSES_FIRST_BYTE_TIMEOUT_MS", 60_000, {
      min: 1,
      max: 3_600_000,
    }),
    streamIdleTimeoutMs: integerEnv(env, "RESPONSES_STREAM_IDLE_TIMEOUT_MS", 60_000, {
      min: 1,
      max: 3_600_000,
    }),
    nonStreamTimeoutMs: integerEnv(env, "RESPONSES_NON_STREAM_TIMEOUT_MS", 120_000, {
      min: 1,
      max: 3_600_000,
    }),
    maxRequestBodyBytes: maxBodyMb * 1024 * 1024,
    rateLimitWindowSeconds: integerEnv(env, "RESPONSES_RATE_LIMIT_WINDOW_SECONDS", 60, {
      min: 1,
      max: 86_400,
    }),
    rateLimitTotal: integerEnv(env, "RESPONSES_RATE_LIMIT_TOTAL", 0, {
      min: 0,
      max: 10_000_000,
    }),
    rateLimitSuccess: integerEnv(env, "RESPONSES_RATE_LIMIT_SUCCESS", 0, {
      min: 0,
      max: 10_000_000,
    }),
  };
}

export const responsesRelayConfig = readResponsesRelayConfig();
