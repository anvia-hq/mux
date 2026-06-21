import { afterEach, describe, expect, it, vi } from "vitest";

describe("prisma", () => {
  it("exports a prisma instance with DATABASE_URL set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    const mod = await import("./prisma");
    expect(mod.prisma).toBeDefined();
    vi.unstubAllEnvs();
  });
});