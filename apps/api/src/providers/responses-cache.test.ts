import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetResponsesCacheForTests,
  buildResponsesCacheKey,
  getResponsesCacheTtlSeconds,
  isResponsesCacheEnabled,
  readCachedResponse,
  writeCachedResponse,
} from "./responses-cache";

const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock("../utils/redis", () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

describe("responses-cache config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetResponsesCacheForTests();
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
  });

  describe("isResponsesCacheEnabled", () => {
    it("returns false when MUX_RESPONSES_CACHE is unset", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE", "");
      expect(isResponsesCacheEnabled()).toBe(false);
    });

    it("returns true only when MUX_RESPONSES_CACHE is exactly '1'", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE", "1");
      expect(isResponsesCacheEnabled()).toBe(true);
    });

    it("returns false for other truthy values", () => {
      for (const value of ["true", "yes", "on", "0", "enabled"]) {
        vi.stubEnv("MUX_RESPONSES_CACHE", value);
        _resetResponsesCacheForTests();
        expect(isResponsesCacheEnabled(), `value="${value}"`).toBe(false);
      }
    });
  });

  describe("getResponsesCacheTtlSeconds", () => {
    it("defaults to 300 when MUX_RESPONSES_CACHE_TTL_SECONDS is unset", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE_TTL_SECONDS", "");
      expect(getResponsesCacheTtlSeconds()).toBe(300);
    });

    it("honors MUX_RESPONSES_CACHE_TTL_SECONDS when set to a positive integer", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE_TTL_SECONDS", "60");
      expect(getResponsesCacheTtlSeconds()).toBe(60);
    });

    it("falls back to 300 for non-numeric values", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE_TTL_SECONDS", "abc");
      expect(getResponsesCacheTtlSeconds()).toBe(300);
    });

    it("falls back to 300 for values < 1", () => {
      vi.stubEnv("MUX_RESPONSES_CACHE_TTL_SECONDS", "0");
      expect(getResponsesCacheTtlSeconds()).toBe(300);
      vi.stubEnv("MUX_RESPONSES_CACHE_TTL_SECONDS", "-5");
      _resetResponsesCacheForTests();
      expect(getResponsesCacheTtlSeconds()).toBe(300);
    });
  });
});

describe("responses-cache round-trip", () => {
  afterEach(() => {
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
  });

  it("builds a per-API-key cache key", () => {
    expect(buildResponsesCacheKey("key-1", "openai", "resp_abc")).toBe(
      "key-1:openai:resp_abc",
    );
  });

  it("returns null on a cache miss", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    expect(await readCachedResponse("key-1", "openai", "resp_abc")).toBeNull();
  });

  it("returns the parsed ResponseObject on a cache hit", async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({ id: "resp_abc", object: "response", status: "completed" }),
    );
    expect(await readCachedResponse("key-1", "openai", "resp_abc")).toEqual({
      id: "resp_abc",
      object: "response",
      status: "completed",
    });
  });

  it("writes the response with the configured TTL", async () => {
    mockRedisSet.mockResolvedValueOnce("OK");
    const response = { id: "resp_abc", object: "response" };
    await writeCachedResponse("key-1", "openai", "resp_abc", response, 60);
    expect(mockRedisSet).toHaveBeenCalledWith(
      "key-1:openai:resp_abc",
      JSON.stringify(response),
      "EX",
      60,
    );
  });

  it("isolates entries across API keys", async () => {
    mockRedisGet.mockImplementation(async (key: string) =>
      key === "key-1:openai:resp_abc"
        ? JSON.stringify({ id: "resp_abc", _ownedBy: "key-1" })
        : null,
    );
    expect(await readCachedResponse("key-2", "openai", "resp_abc")).toBeNull();
    expect(await readCachedResponse("key-1", "openai", "resp_abc")).toEqual({
      id: "resp_abc",
      _ownedBy: "key-1",
    });
  });
});
