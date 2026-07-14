import { describe, expect, it } from "vitest";
import { statusCodeMatches } from "../../../../src/modules/chat/relay/config";
import { readResponsesRelayConfig } from "../../../../src/modules/responses/relay/config";

describe("Responses relay config", () => {
  it("uses independent defaults equivalent to the chat relay", () => {
    const config = readResponsesRelayConfig({});
    expect(config).toMatchObject({
      retryCount: 2,
      firstByteTimeoutMs: 60_000,
      streamIdleTimeoutMs: 60_000,
      nonStreamTimeoutMs: 120_000,
      maxRequestBodyBytes: 128 * 1024 * 1024,
      rateLimitWindowSeconds: 60,
      rateLimitTotal: 0,
      rateLimitSuccess: 0,
    });
    expect(statusCodeMatches(config.retryStatusCodes, 429)).toBe(true);
    expect(statusCodeMatches(config.retryStatusCodes, 503)).toBe(true);
    expect(statusCodeMatches(config.retryStatusCodes, 400)).toBe(false);
  });

  it("reads Responses-specific overrides and rejects invalid values", () => {
    const config = readResponsesRelayConfig({
      RESPONSES_RETRY_COUNT: "4",
      RESPONSES_RETRY_STATUS_CODES: "425,500-503",
      RESPONSES_FIRST_BYTE_TIMEOUT_MS: "1000",
      RESPONSES_STREAM_IDLE_TIMEOUT_MS: "2000",
      RESPONSES_NON_STREAM_TIMEOUT_MS: "3000",
      RESPONSES_MAX_REQUEST_BODY_MB: "8",
      RESPONSES_RATE_LIMIT_WINDOW_SECONDS: "30",
      RESPONSES_RATE_LIMIT_TOTAL: "100",
      RESPONSES_RATE_LIMIT_SUCCESS: "80",
    });
    expect(config).toMatchObject({
      retryCount: 4,
      firstByteTimeoutMs: 1000,
      streamIdleTimeoutMs: 2000,
      nonStreamTimeoutMs: 3000,
      maxRequestBodyBytes: 8 * 1024 * 1024,
      rateLimitWindowSeconds: 30,
      rateLimitTotal: 100,
      rateLimitSuccess: 80,
    });
    expect(statusCodeMatches(config.retryStatusCodes, 425)).toBe(true);
    expect(statusCodeMatches(config.retryStatusCodes, 504)).toBe(false);
    expect(() => readResponsesRelayConfig({ RESPONSES_RETRY_COUNT: "-1" })).toThrow(
      "RESPONSES_RETRY_COUNT",
    );
  });
});
