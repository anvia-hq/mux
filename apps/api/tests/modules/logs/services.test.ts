import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    requestLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { getLogs, getStats } from "../../../src/modules/logs/services";

describe("logs services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getLogs", () => {
    it("returns paginated logs with total count", async () => {
      mockPrisma.requestLog.findMany.mockResolvedValueOnce([
        {
          id: "log-1",
          apiKeyId: "key-1",
          provider: "openai",
          model: "gpt-4",
          endpoint: "/v1/chat",
          latencyMs: 100,
          providerLatencyMs: null,
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          estimatedCost: 0.01,
          statusCode: 200,
          errorMessage: null,
          createdAt: new Date(),
          apiKey: { name: "test" },
        },
      ]);
      mockPrisma.requestLog.count.mockResolvedValueOnce(42);

      const result = await getLogs({});
      expect(result.total).toBe(42);
      expect(result.logs).toHaveLength(1);
    });

    it("applies filter params to where clause", async () => {
      mockPrisma.requestLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.requestLog.count.mockResolvedValueOnce(0);
      await getLogs({
        provider: "openai",
        model: "gpt-4",
        apiKeyId: "key-1",
        ownerUserId: "user-1",
        limit: 10,
        offset: 5,
      });
      expect(mockPrisma.requestLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 5,
          where: expect.objectContaining({
            apiKeyId: "key-1",
            apiKey: { createdBy: "user-1" },
          }),
        }),
      );
    });
  });

  describe("getStats", () => {
    it("returns aggregate stats", async () => {
      mockPrisma.requestLog.count.mockResolvedValueOnce(100);
      mockPrisma.requestLog.aggregate
        .mockResolvedValueOnce({
          _sum: { totalTokens: 5000, promptTokens: 3000, completionTokens: 2000 },
        })
        .mockResolvedValueOnce({ _sum: { estimatedCost: 2.5 } });
      mockPrisma.requestLog.groupBy
        .mockResolvedValueOnce([
          {
            provider: "openai",
            _count: { _all: 2 },
            _sum: {
              totalTokens: 30,
              promptTokens: 10,
              completionTokens: 20,
              estimatedCost: 0.2,
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            model: "gpt-4",
            _count: { _all: 2 },
            _sum: {
              totalTokens: 30,
              promptTokens: 10,
              completionTokens: 20,
              estimatedCost: 0.2,
            },
          },
        ]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          date: "2026-06-21",
          requests: 2,
          tokens: 30,
          promptTokens: 10,
          completionTokens: 20,
          cost: 0.2,
        },
      ]);

      const stats = await getStats({ days: 7, endDate: new Date("2026-06-21T12:00:00.000Z") });
      expect(stats.totalRequests).toBe(100);
      expect(stats.totalTokens).toBe(5000);
      expect(stats.totalPromptTokens).toBe(3000);
      expect(stats.totalCompletionTokens).toBe(2000);
      expect(stats.byProvider[0]).toMatchObject({
        provider: "openai",
        requests: 2,
        tokens: 30,
        promptTokens: 10,
        completionTokens: 20,
        cost: 0.2,
      });
      expect(stats.byModel[0]).toMatchObject({
        model: "gpt-4",
        requests: 2,
        tokens: 30,
        promptTokens: 10,
        completionTokens: 20,
        cost: 0.2,
      });
      expect(stats.daily).toHaveLength(7);
      expect(stats.daily.at(-1)).toEqual({
        date: "2026-06-21",
        requests: 2,
        tokens: 30,
        promptTokens: 10,
        completionTokens: 20,
        cost: 0.2,
      });
    });

    it("applies provider and model filters to stats queries", async () => {
      mockPrisma.requestLog.count.mockResolvedValueOnce(0);
      mockPrisma.requestLog.aggregate
        .mockResolvedValueOnce({
          _sum: { totalTokens: null, promptTokens: null, completionTokens: null },
        })
        .mockResolvedValueOnce({ _sum: { estimatedCost: null } });
      mockPrisma.requestLog.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      await getStats({
        apiKeyId: "key-1",
        provider: "openai",
        model: "gpt-4",
        ownerUserId: "user-1",
        days: 30,
        endDate: new Date("2026-06-21T12:00:00.000Z"),
      });

      expect(mockPrisma.requestLog.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          apiKeyId: "key-1",
          provider: "openai",
          model: "gpt-4",
          apiKey: { createdBy: "user-1" },
        }),
      });
    });
  });
});
