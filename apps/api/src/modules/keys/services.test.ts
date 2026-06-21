import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    apiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    requestLog: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

const { mockCacheGet, mockCacheSet } = vi.hoisted(() => ({
  mockCacheGet: vi.fn().mockResolvedValue(null),
  mockCacheSet: vi.fn().mockResolvedValue(undefined),
}));

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    incrbyfloat: vi.fn(),
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../utils/cache", () => ({ cacheGet: mockCacheGet, cacheSet: mockCacheSet }));
vi.mock("../../utils/redis", () => ({ redis: mockRedis }));

import {
  addApiKeySpendUsd,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  createApiKey,
  generateApiKey,
  getApiKeySpentUsd,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
} from "./services";

describe("keys services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateApiKey", () => {
    it("produces prefixed hex key with sha256 hash", () => {
      const { raw, hashed } = generateApiKey();
      expect(raw).toMatch(/^mux_live_[0-9a-f]{64}$/);
      expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("createApiKey", () => {
    it("stores hashed key and returns raw key with id", async () => {
      mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "key-1", key: "hashed-val" });
      const result = await createApiKey("my-key", "user-1", 25);
      expect(result.id).toBe("key-1");
      expect(result.key).toMatch(/^mux_live_/);
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ spendLimitUsd: 25 }),
        }),
      );
    });
  });

  describe("validateApiKey", () => {
    it("returns cached result on cache hit for active key", async () => {
      mockCacheGet.mockResolvedValueOnce({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: null,
      });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({ id: "k1", name: "test", isActive: true, spendLimitUsd: null });
    });

    it("falls through to DB on cache miss", async () => {
      mockCacheGet.mockResolvedValueOnce(null);
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: 10,
      });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({ id: "k1", name: "test", isActive: true, spendLimitUsd: 10 });
    });

    it("returns null when key not found in DB", async () => {
      mockCacheGet.mockResolvedValueOnce(null);
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce(null);
      const result = await validateApiKey("mux_live_unknown");
      expect(result).toBeNull();
    });
  });

  describe("revokeApiKey", () => {
    it("sets isActive to false", async () => {
      mockPrisma.apiKey.update.mockResolvedValueOnce({ id: "k1", key: "hash", isActive: false });
      await revokeApiKey("k1");
      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "k1" }, data: { isActive: false } }),
      );
    });
  });

  describe("listApiKeys", () => {
    it("returns all keys with creator email", async () => {
      mockPrisma.apiKey.findMany.mockResolvedValueOnce([
        {
          id: "k1",
          name: "test",
          isActive: true,
          spendLimitUsd: 10,
          createdAt: new Date(),
          creator: { email: "a@b.com" },
        },
      ]);
      mockPrisma.requestLog.groupBy.mockResolvedValueOnce([
        { apiKeyId: "k1", _sum: { estimatedCost: 2.5 } },
      ]);
      const keys = await listApiKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toEqual(expect.objectContaining({ spentUsd: 2.5, remainingUsd: 7.5 }));
    });
  });

  describe("spend limits", () => {
    it("returns Redis ledger spend", async () => {
      mockRedis.get.mockResolvedValueOnce("3.25");
      await expect(getApiKeySpentUsd("k1")).resolves.toBe(3.25);
    });

    it("allows unlimited keys without querying spend", async () => {
      await assertApiKeyCanSpend("k1", null);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("throws when spend reaches the limit", async () => {
      mockRedis.get.mockResolvedValueOnce("10");
      await expect(assertApiKeyCanSpend("k1", 10)).rejects.toBeInstanceOf(
        ApiKeySpendLimitExceededError,
      );
    });

    it("increments Redis ledger spend", async () => {
      mockRedis.incrbyfloat.mockResolvedValueOnce("3.75");
      await expect(addApiKeySpendUsd("k1", 1.25)).resolves.toBe(3.75);
      expect(mockRedis.incrbyfloat).toHaveBeenCalledWith("apikey_spend:k1", 1.25);
    });

    it("throws typed error when Redis ledger is unavailable", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("redis down"));
      await expect(getApiKeySpentUsd("k1")).rejects.toBeInstanceOf(
        ApiKeySpendLedgerUnavailableError,
      );
    });
  });
});
