import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    apiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    requestLog: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

const { mockCacheDelete, mockCacheGet, mockCacheSet } = vi.hoisted(() => ({
  mockCacheDelete: vi.fn().mockResolvedValue(undefined),
  mockCacheGet: vi.fn().mockResolvedValue(null),
  mockCacheSet: vi.fn().mockResolvedValue(undefined),
}));

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    incrbyfloat: vi.fn(),
  },
}));

const { mockListPublicModels } = vi.hoisted(() => ({
  mockListPublicModels: vi.fn(),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/utils/cache", () => ({
  cacheDelete: mockCacheDelete,
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}));
vi.mock("../../../src/utils/redis", () => ({ redis: mockRedis }));
vi.mock("../../../src/providers/registry", () => ({
  listPublicModels: mockListPublicModels,
  toPublicModelId: (provider: string, modelId: string) => `${provider}:${modelId}`,
}));

import {
  addApiKeySpendUsd,
  ApiKeyModelFilterValidationError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  createApiKey,
  freezeLegacyApiKeyModelAccess,
  generateApiKey,
  getApiKeySpentUsd,
  listApiKeys,
  revokeApiKey,
  updateApiKeyModelAccess,
  validateApiKey,
} from "../../../src/modules/keys/services";

describe("keys services", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockListPublicModels.mockReset();
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
      mockListPublicModels.mockResolvedValueOnce([
        { id: "gpt-4o", provider: "openai" },
        { id: "fast", provider: "mux" },
      ]);
      mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "key-1", key: "hashed-val" });
      const result = await createApiKey("my-key", "user-1", 25);
      expect(result.id).toBe("key-1");
      expect(result.key).toMatch(/^mux_live_/);
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            spendLimitUsd: 25,
            allowAllModels: false,
            includeFutureModels: false,
            allowedModelIds: ["openai:gpt-4o", "mux:fast"],
          }),
        }),
      );
    });

    it("stores explicit future model access", async () => {
      mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "key-1", key: "hashed-val" });

      await createApiKey("my-key", "user-1", null, null, true);

      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allowAllModels: true,
            includeFutureModels: true,
            allowedModelIds: [],
          }),
        }),
      );
    });

    it("stores selected model ids for filtered keys", async () => {
      mockListPublicModels.mockResolvedValueOnce([
        { id: "gpt-4o", provider: "openai" },
        { id: "fast", provider: "mux" },
      ]);
      mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "key-1", key: "hashed-val" });

      await createApiKey("my-key", "user-1", null, ["openai:gpt-4o", "mux:fast", "openai:gpt-4o"]);

      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allowAllModels: false,
            includeFutureModels: false,
            allowedModelIds: ["openai:gpt-4o", "mux:fast"],
          }),
        }),
      );
    });

    it("rejects empty model filters", async () => {
      await expect(createApiKey("my-key", "user-1", null, [])).rejects.toBeInstanceOf(
        ApiKeyModelFilterValidationError,
      );
      expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
    });

    it("rejects unknown model filters", async () => {
      mockListPublicModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);

      await expect(createApiKey("my-key", "user-1", null, ["anthropic:claude"])).rejects.toThrow(
        "unknown or unavailable model",
      );
      expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
    });
  });

  describe("validateApiKey", () => {
    it("returns cached result on cache hit for active key", async () => {
      mockCacheGet.mockResolvedValueOnce({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: null,
        includeFutureModels: true,
        allowAllModels: true,
      });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: null,
        allowAllModels: true,
        includeFutureModels: true,
        allowedModelIds: [],
      });
    });

    it("falls through to DB on cache miss", async () => {
      mockCacheGet.mockResolvedValueOnce(null);
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: 10,
        allowAllModels: false,
        includeFutureModels: false,
        allowedModelIds: ["openai:gpt-4o"],
      });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({
        id: "k1",
        name: "test",
        isActive: true,
        spendLimitUsd: 10,
        allowAllModels: false,
        includeFutureModels: false,
        allowedModelIds: ["openai:gpt-4o"],
      });
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
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o"],
          createdAt: new Date(),
          creator: { email: "a@b.com" },
        },
      ]);
      mockPrisma.requestLog.groupBy.mockResolvedValueOnce([
        { apiKeyId: "k1", _sum: { estimatedCost: 2.5 } },
      ]);
      const keys = await listApiKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toEqual(
        expect.objectContaining({
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o"],
          spentUsd: 2.5,
          remainingUsd: 7.5,
        }),
      );
    });
  });

  describe("model access updates", () => {
    it("updates model access and invalidates cache", async () => {
      mockListPublicModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
      mockPrisma.apiKey.update.mockResolvedValueOnce({ key: "hashed-key" });

      await updateApiKeyModelAccess("k1", {
        mode: "selected",
        allowedModelIds: ["openai:gpt-4o"],
      });

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "k1" },
          data: {
            allowAllModels: false,
            includeFutureModels: false,
            allowedModelIds: ["openai:gpt-4o"],
          },
        }),
      );
      expect(mockCacheDelete).toHaveBeenCalledWith("apikey:hashed-key");
    });

    it("freezes legacy all-model keys to a current snapshot", async () => {
      mockPrisma.apiKey.findMany.mockResolvedValueOnce([
        { id: "k1", key: "hashed-1" },
        { id: "k2", key: "hashed-2" },
      ]);
      mockListPublicModels.mockResolvedValueOnce([
        { id: "gpt-4o", provider: "openai" },
        { id: "fast", provider: "mux" },
      ]);
      mockPrisma.apiKey.updateMany.mockResolvedValueOnce({ count: 2 });

      await expect(freezeLegacyApiKeyModelAccess()).resolves.toBe(2);

      expect(mockPrisma.apiKey.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["k1", "k2"] } },
        data: {
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o", "mux:fast"],
        },
      });
      expect(mockCacheDelete).toHaveBeenCalledWith("apikey:hashed-1");
      expect(mockCacheDelete).toHaveBeenCalledWith("apikey:hashed-2");
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
