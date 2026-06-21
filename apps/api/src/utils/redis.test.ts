import { afterEach, describe, expect, it, vi } from "vitest";

describe("redis", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("exports a redis instance", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    const mod = await import("./redis");
    expect(mod.redis).toBeDefined();
  });
});