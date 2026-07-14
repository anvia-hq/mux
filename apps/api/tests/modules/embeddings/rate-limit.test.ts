import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEval, mockExec, mockExpire, mockIncr, mockMulti } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockExec: vi.fn(),
  mockExpire: vi.fn(),
  mockIncr: vi.fn(),
  mockMulti: vi.fn(),
}));

vi.mock("../../../src/utils/redis", () => ({
  redis: {
    eval: mockEval,
    multi: mockMulti,
  },
}));

import { readEmbeddingsRelayConfig } from "../../../src/modules/embeddings/relay/config";
import {
  checkEmbeddingsRateLimit,
  EmbeddingsRateLimitUnavailableError,
  recordEmbeddingsRateLimitSuccess,
} from "../../../src/modules/embeddings/relay/rate-limit";

describe("Embeddings rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMulti.mockReturnValue({ incr: mockIncr });
    mockIncr.mockReturnValue({ expire: mockExpire });
    mockExpire.mockReturnValue({ exec: mockExec });
  });

  it("does not use Redis when both limits are disabled", async () => {
    await checkEmbeddingsRateLimit("key-1", readEmbeddingsRelayConfig({}), 60_000);
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("returns the remaining window when a configured limit is exceeded", async () => {
    mockEval.mockResolvedValueOnce([0, "total"]);
    const config = readEmbeddingsRelayConfig({
      EMBEDDINGS_RATE_LIMIT_WINDOW_SECONDS: "60",
      EMBEDDINGS_RATE_LIMIT_TOTAL: "2",
    });
    await expect(checkEmbeddingsRateLimit("key-1", config, 90_000)).rejects.toMatchObject({
      retryAfterSeconds: 30,
    });
  });

  it("records successful requests in the same fixed window", async () => {
    mockExec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);
    const config = readEmbeddingsRelayConfig({ EMBEDDINGS_RATE_LIMIT_SUCCESS: "1" });
    await recordEmbeddingsRateLimitSuccess("key-1", config, 60_000);
    expect(mockIncr).toHaveBeenCalledWith("embeddings_rate:success:key-1:1");
  });

  it("fails closed when Redis is unavailable", async () => {
    mockEval.mockRejectedValueOnce(new Error("offline"));
    const config = readEmbeddingsRelayConfig({ EMBEDDINGS_RATE_LIMIT_TOTAL: "1" });
    await expect(checkEmbeddingsRateLimit("key-1", config, 60_000)).rejects.toBeInstanceOf(
      EmbeddingsRateLimitUnavailableError,
    );
  });
});
