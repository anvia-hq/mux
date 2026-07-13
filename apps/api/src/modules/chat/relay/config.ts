export type StatusCodeRange = { start: number; end: number };

export type ChatRelayConfig = {
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

const DEFAULT_RETRY_STATUS_CODES = "408,409,425,429,500-599";

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  input: { min: number; max: number },
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new Error(`${name} must be an integer between ${input.min} and ${input.max}`);
  }
  return parsed;
}

export function parseStatusCodeRanges(raw: string): StatusCodeRange[] {
  const ranges = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d{3})(?:-(\d{3}))?$/.exec(part);
      if (!match) throw new Error(`invalid HTTP status code range: ${part}`);
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (start < 100 || end > 599 || start > end) {
        throw new Error(`invalid HTTP status code range: ${part}`);
      }
      return { start, end };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (ranges.length === 0) throw new Error("retry status code ranges cannot be empty");
  return ranges;
}

export function statusCodeMatches(ranges: StatusCodeRange[], status: number): boolean {
  return ranges.some((range) => status >= range.start && status <= range.end);
}

export function readChatRelayConfig(env: NodeJS.ProcessEnv = process.env): ChatRelayConfig {
  const maxRequestBodyMb = integerEnv(env, "CHAT_MAX_REQUEST_BODY_MB", 128, {
    min: 1,
    max: 1024,
  });
  return {
    retryCount: integerEnv(env, "CHAT_RETRY_COUNT", 2, { min: 0, max: 10 }),
    retryStatusCodes: parseStatusCodeRanges(
      env.CHAT_RETRY_STATUS_CODES?.trim() || DEFAULT_RETRY_STATUS_CODES,
    ),
    firstByteTimeoutMs: integerEnv(env, "CHAT_FIRST_BYTE_TIMEOUT_MS", 60_000, {
      min: 1,
      max: 3_600_000,
    }),
    streamIdleTimeoutMs: integerEnv(env, "CHAT_STREAM_IDLE_TIMEOUT_MS", 60_000, {
      min: 1,
      max: 3_600_000,
    }),
    nonStreamTimeoutMs: integerEnv(env, "CHAT_NON_STREAM_TIMEOUT_MS", 120_000, {
      min: 1,
      max: 3_600_000,
    }),
    maxRequestBodyBytes: maxRequestBodyMb * 1024 * 1024,
    rateLimitWindowSeconds: integerEnv(env, "CHAT_RATE_LIMIT_WINDOW_SECONDS", 60, {
      min: 1,
      max: 86_400,
    }),
    rateLimitTotal: integerEnv(env, "CHAT_RATE_LIMIT_TOTAL", 0, {
      min: 0,
      max: 10_000_000,
    }),
    rateLimitSuccess: integerEnv(env, "CHAT_RATE_LIMIT_SUCCESS", 0, {
      min: 0,
      max: 10_000_000,
    }),
  };
}

export const chatRelayConfig = readChatRelayConfig();
