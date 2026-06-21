import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    apiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { mockCacheGet, mockCacheSet } = vi.hoisted(() => ({
  mockCacheGet: vi.fn().mockResolvedValue(null),
  mockCacheSet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../utils/cache", () => ({ cacheGet: mockCacheGet, cacheSet: mockCacheSet }));

import { createApiKey, generateApiKey, listApiKeys, revokeApiKey, validateApiKey } from "./services";

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
      const result = await createApiKey("my-key", "user-1");
      expect(result.id).toBe("key-1");
      expect(result.key).toMatch(/^mux_live_/);
    });
  });

  describe("validateApiKey", () => {
    it("returns cached result on cache hit for active key", async () => {
      mockCacheGet.mockResolvedValueOnce({ id: "k1", name: "test", isActive: true });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({ id: "k1", name: "test", isActive: true });
    });

    it("falls through to DB on cache miss", async () => {
      mockCacheGet.mockResolvedValueOnce(null);
      mockPrisma.apiKey.findUnique.mockResolvedValueOnce({ id: "k1", name: "test", isActive: true });
      const result = await validateApiKey("mux_live_test");
      expect(result).toEqual({ id: "k1", name: "test", isActive: true });
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
        { id: "k1", name: "test", isActive: true, createdAt: new Date(), creator: { email: "a@b.com" } },
      ]);
      const keys = await listApiKeys();
      expect(keys).toHaveLength(1);
    });
  });
});