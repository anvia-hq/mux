import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

describe("prisma", () => {
  it("exports a prisma instance with DATABASE_URL set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    const mod = await import("./prisma");
    expect(mod.prisma).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("registers BackgroundResponseJob on the generated Prisma client", () => {
    expect(Prisma.ModelName.BackgroundResponseJob).toBe("BackgroundResponseJob");
  });
});
