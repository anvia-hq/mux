import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEval, mockExec, mockIncr, mockMulti } = vi.hoisted(() => {
  const mockExec = vi.fn();
  const mockExpire = vi.fn();
  const mockIncr = vi.fn();
  return {
    mockEval: vi.fn(),
    mockExec,
    mockIncr,
    mockMulti: vi.fn(() => ({
      incr: mockIncr.mockReturnThis(),
      expire: mockExpire.mockReturnThis(),
      exec: mockExec,
    })),
  };
});

vi.mock("../../../../src/utils/redis", () => ({
  redis: { eval: mockEval, multi: mockMulti },
}));

import { readResponsesRelayConfig } from "../../../../src/modules/responses/relay/config";
import {
  checkResponsesRateLimit,
  recordResponsesRateLimitSuccess,
  ResponsesRateLimitUnavailableError,
} from "../../../../src/modules/responses/relay/rate-limit";

describe("Responses rate limits", () => {
  afterEach(() => vi.clearAllMocks());

  it("is fully disabled by default", async () => {
    await checkResponsesRateLimit("key-1", readResponsesRelayConfig({}), 60_000);
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("checks the Responses fixed window atomically and exposes Retry-After", async () => {
    const config = readResponsesRelayConfig({
      RESPONSES_RATE_LIMIT_TOTAL: "10",
      RESPONSES_RATE_LIMIT_SUCCESS: "5",
      RESPONSES_RATE_LIMIT_WINDOW_SECONDS: "60",
    });
    mockEval.mockResolvedValueOnce([0, "total"]);
    await expect(checkResponsesRateLimit("key-1", config, 90_000)).rejects.toMatchObject({
      retryAfterSeconds: 30,
    });
    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining("successLimit"),
      2,
      "responses_rate:total:key-1:1",
      "responses_rate:success:key-1:1",
      "5",
      "10",
      "61",
    );
  });

  it("records successes and fails closed when an enabled limiter is unavailable", async () => {
    const config = readResponsesRelayConfig({ RESPONSES_RATE_LIMIT_SUCCESS: "5" });
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    await recordResponsesRateLimitSuccess("key-1", config, 60_000);
    expect(mockIncr).toHaveBeenCalledWith("responses_rate:success:key-1:1");

    mockEval.mockRejectedValueOnce(new Error("redis offline"));
    await expect(checkResponsesRateLimit("key-1", config, 60_000)).rejects.toBeInstanceOf(
      ResponsesRateLimitUnavailableError,
    );
  });
});
