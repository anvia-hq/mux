import { describe, expect, it } from "vitest";
import {
  parseStatusCodeRanges,
  readChatRelayConfig,
  statusCodeMatches,
} from "../../../../src/modules/chat/relay/config";

describe("chat relay config", () => {
  it("uses the agreed defaults", () => {
    const config = readChatRelayConfig({});
    expect(config).toMatchObject({
      retryCount: 2,
      firstByteTimeoutMs: 60_000,
      streamIdleTimeoutMs: 60_000,
      nonStreamTimeoutMs: 120_000,
      maxRequestBodyBytes: 128 * 1024 * 1024,
      rateLimitTotal: 0,
      rateLimitSuccess: 0,
    });
    expect(statusCodeMatches(config.retryStatusCodes, 429)).toBe(true);
    expect(statusCodeMatches(config.retryStatusCodes, 503)).toBe(true);
    expect(statusCodeMatches(config.retryStatusCodes, 400)).toBe(false);
  });

  it("parses sorted status ranges and rejects invalid configuration", () => {
    expect(parseStatusCodeRanges("500-503, 429,408")).toEqual([
      { start: 408, end: 408 },
      { start: 429, end: 429 },
      { start: 500, end: 503 },
    ]);
    expect(() => parseStatusCodeRanges("600")).toThrow("invalid HTTP status code range");
    expect(() => readChatRelayConfig({ CHAT_RETRY_COUNT: "-1" })).toThrow("CHAT_RETRY_COUNT");
  });
});
