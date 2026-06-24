import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetResponsesCacheForTests,
  getResponsesCacheTtlSeconds,
  isResponsesCacheEnabled,
} from "./responses-cache";

describe("responses-cache config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetResponsesCacheForTests();
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
