import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEval, mockExec, mockIncr, mockMulti } = vi.hoisted(() => {
  const mockExec = vi.fn();
  const mockExpire = vi.fn();
  const mockIncr = vi.fn();
  return {
    mockEval: vi.fn(),
    mockExec,
    mockExpire,
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

import { readChatRelayConfig } from "../../../../src/modules/chat/relay/config";
import {
  ChatRateLimitExceededError,
  ChatRateLimitUnavailableError,
  checkChatRateLimit,
  recordChatRateLimitSuccess,
} from "../../../../src/modules/chat/relay/rate-limit";

describe("chat rate limits", () => {
  afterEach(() => vi.clearAllMocks());

  it("is fully disabled by default", async () => {
    await checkChatRateLimit("key-1", readChatRelayConfig({}), 60_000);
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("checks the fixed window atomically and exposes Retry-After", async () => {
    const config = readChatRelayConfig({
      CHAT_RATE_LIMIT_TOTAL: "10",
      CHAT_RATE_LIMIT_SUCCESS: "5",
      CHAT_RATE_LIMIT_WINDOW_SECONDS: "60",
    });
    mockEval.mockResolvedValueOnce([0, "total"]);
    await expect(checkChatRateLimit("key-1", config, 90_000)).rejects.toMatchObject({
      retryAfterSeconds: 30,
    } satisfies Partial<ChatRateLimitExceededError>);
    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining("successLimit"),
      2,
      "chat_rate:total:key-1:1",
      "chat_rate:success:key-1:1",
      "5",
      "10",
      "61",
    );
  });

  it("records successes and fails closed when an enabled limiter is unavailable", async () => {
    const config = readChatRelayConfig({ CHAT_RATE_LIMIT_SUCCESS: "5" });
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    await recordChatRateLimitSuccess("key-1", config, 60_000);
    expect(mockIncr).toHaveBeenCalledWith("chat_rate:success:key-1:1");

    mockEval.mockRejectedValueOnce(new Error("redis offline"));
    await expect(checkChatRateLimit("key-1", config, 60_000)).rejects.toBeInstanceOf(
      ChatRateLimitUnavailableError,
    );
  });
});
