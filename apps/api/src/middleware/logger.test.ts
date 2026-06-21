import { afterEach, describe, expect, it, vi } from "vitest";

const { mockEnqueueRequestLog } = vi.hoisted(() => ({
  mockEnqueueRequestLog: vi.fn(),
}));

vi.mock("@repo/worker", () => ({
  enqueueRequestLog: mockEnqueueRequestLog,
}));

import {
  logRequest,
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const baseEntry = {
    apiKeyId: "key-1",
    provider: "openai",
    model: "gpt-4",
    endpoint: "/v1/chat/completions",
    latencyMs: 100,
    statusCode: 200,
  };

  it("enqueues final request logs", async () => {
    mockEnqueueRequestLog.mockResolvedValueOnce(undefined);

    const logId = await logRequest(baseEntry);

    expect(logId).toEqual(expect.any(String));
    expect(mockEnqueueRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "final", logId, statusCode: 200 }),
    );
  });

  it("enqueues stream start and finalize jobs with the same log id", async () => {
    mockEnqueueRequestLog.mockResolvedValue(undefined);

    const logId = await logStreamStart(baseEntry);
    await logStreamFinal({ ...baseEntry, logId, latencyMs: 250 });

    expect(mockEnqueueRequestLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "stream-start", logId, statusCode: 102 }),
    );
    expect(mockEnqueueRequestLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "stream-finalize", logId, latencyMs: 250 }),
    );
  });

  it("throws a typed error when enqueue fails", async () => {
    mockEnqueueRequestLog.mockRejectedValueOnce(new Error("redis down"));

    await expect(logRequest(baseEntry)).rejects.toBeInstanceOf(RequestLoggingUnavailableError);
  });
});
