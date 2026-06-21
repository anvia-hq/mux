import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));

import { getLogs, getStats } from "./services";

describe("logs services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getLogs", () => {
    it("returns paginated logs with total count", async () => {
      mockPrisma.requestLog.findMany.mockResolvedValueOnce([{
        id: "log-1", apiKeyId: "key-1", provider: "openai", model: "gpt-4",
        endpoint: "/v1/chat", latencyMs: 100, providerLatencyMs: null,
        promptTokens: 10, completionTokens: 20, totalTokens: 30,
        estimatedCost: 0.01, statusCode: 200, errorMessage: null,
        createdAt: new Date(), apiKey: { name: "test" },
      }]);
      mockPrisma.requestLog.count.mockResolvedValueOnce(42);

      const result = await getLogs({});
      expect(result.total).toBe(42);
      expect(result.logs).toHaveLength(1);
    });

    it("applies filter params to where clause", async () => {
      mockPrisma.requestLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.requestLog.count.mockResolvedValueOnce(0);
      await getLogs({ provider: "openai", model: "gpt-4", apiKeyId: "key-1", limit: 10, offset: 5 });
      expect(mockPrisma.requestLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 }),
      );
    });
  });

  describe("getStats", () => {
    it("returns aggregate stats", async () => {
      mockPrisma.requestLog.count.mockResolvedValueOnce(100);
      mockPrisma.requestLog.aggregate
        .mockResolvedValueOnce({ _sum: { totalTokens: 5000 } })
        .mockResolvedValueOnce({ _sum: { estimatedCost: 2.5 } });
      mockPrisma.requestLog.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const stats = await getStats({});
      expect(stats.totalRequests).toBe(100);
      expect(stats.totalTokens).toBe(5000);
    });
  });
});