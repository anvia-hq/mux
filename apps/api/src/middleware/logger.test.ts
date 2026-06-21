import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockEstimateCost } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: { createMany: vi.fn() },
  },
  mockEstimateCost: vi.fn().mockReturnValue(0.01),
}));

vi.mock("../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../providers/registry", () => ({ estimateCost: mockEstimateCost }));

import { flushLogBuffer, logRequest, stopLogFlushTimer } from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stopLogFlushTimer();
  });

  it("flushLogBuffer drains buffer", async () => {
    mockPrisma.requestLog.createMany.mockResolvedValueOnce({ count: 1 });
    logRequest({
      apiKeyId: "key-1", provider: "openai", model: "gpt-4",
      endpoint: "/v1/chat/completions", latencyMs: 100, statusCode: 200,
    });
    await flushLogBuffer();
    expect(mockPrisma.requestLog.createMany).toHaveBeenCalled();
  });

  it("re-adds entries on DB write failure", async () => {
    mockPrisma.requestLog.createMany.mockRejectedValueOnce(new Error("DB down"));
    logRequest({
      apiKeyId: "key-1", provider: "openai", model: "gpt-4",
      endpoint: "/v1/chat/completions", latencyMs: 100, statusCode: 200,
    });
    await flushLogBuffer();

    mockPrisma.requestLog.createMany.mockResolvedValueOnce({ count: 1 });
    await flushLogBuffer();
    expect(mockPrisma.requestLog.createMany).toHaveBeenCalled();
  });
});