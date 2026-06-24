import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("./redis", () => ({ redis: mockRedis }));

import { cacheGet, cacheSet, cacheDelete } from "./cache";

describe("cache", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("cacheGet", () => {
    it("returns null on cache miss", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      await expect(cacheGet("key")).resolves.toBeNull();
    });

    it("returns parsed JSON on cache hit", async () => {
      mockRedis.get.mockResolvedValueOnce('{"foo":"bar"}');
      await expect(cacheGet<{ foo: string }>("key")).resolves.toEqual({ foo: "bar" });
    });

    it("returns null on invalid JSON", async () => {
      mockRedis.get.mockResolvedValueOnce("not-json");
      await expect(cacheGet("key")).resolves.toBeNull();
    });
  });

  describe("cacheSet", () => {
    it("sets key with JSON value and TTL", async () => {
      await cacheSet("key", { foo: "bar" });
      expect(mockRedis.set).toHaveBeenCalledWith("key", '{"foo":"bar"}', "EX", 600);
    });

    it("uses custom TTL", async () => {
      await cacheSet("key", "value", 60);
      expect(mockRedis.set).toHaveBeenCalledWith("key", '"value"', "EX", 60);
    });
  });

  describe("cacheDelete", () => {
    it("deletes key", async () => {
      await cacheDelete("key");
      expect(mockRedis.del).toHaveBeenCalledWith("key");
    });
  });
});
