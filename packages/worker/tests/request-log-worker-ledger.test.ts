import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRedisSet, mockRedisOn } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisOn: vi.fn(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: {
      groupBy: vi.fn(),
    },
    apiKey: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn(function IORedisMock() {
    return {
      on: mockRedisOn,
      set: mockRedisSet,
    };
  }),
}));

vi.mock("../src/prisma", () => ({ prisma: mockPrisma }));

import { initializeSpendLedgerFromRequestLogs } from "../src/request-log-worker";

describe("initializeSpendLedgerFromRequestLogs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("seeds API key and owner spend ledgers from successful request logs", async () => {
    mockPrisma.requestLog.groupBy.mockResolvedValueOnce([
      { apiKeyId: "key-1", _sum: { estimatedCost: 2 } },
      { apiKeyId: "key-2", _sum: { estimatedCost: 3 } },
      { apiKeyId: "key-3", _sum: { estimatedCost: null } },
    ]);
    mockPrisma.apiKey.findMany.mockResolvedValueOnce([
      { id: "key-1", createdBy: "user-1" },
      { id: "key-2", createdBy: "user-1" },
      { id: "key-3", createdBy: "user-2" },
    ]);

    await initializeSpendLedgerFromRequestLogs();

    expect(mockRedisSet).toHaveBeenCalledWith("apikey_spend:key-1", "2", "NX");
    expect(mockRedisSet).toHaveBeenCalledWith("apikey_spend:key-2", "3", "NX");
    expect(mockRedisSet).toHaveBeenCalledWith("apikey_spend:key-3", "0", "NX");
    expect(mockRedisSet).toHaveBeenCalledWith("user_spend:user-1", "5", "NX");
    expect(mockRedisSet).toHaveBeenCalledWith("user_spend:user-2", "0", "NX");
  });
});
