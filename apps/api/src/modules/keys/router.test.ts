import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    apiKey: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    requestLog: { groupBy: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("../../utils/cache", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/redis", () => ({
  redis: {
    get: vi.fn(),
    incrbyfloat: vi.fn(),
  },
}));

import { keysRouter } from "./router";
import { revokeApiKey } from "./services";

vi.mock("./services", async (importOriginal) => {
  const original = await importOriginal<typeof import("./services")>();
  return {
    ...original,
    revokeApiKey: vi.fn(original.revokeApiKey),
  };
});

describe("keys router", () => {
  afterEach(() => vi.clearAllMocks());

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      email: "a@b.com",
      name: "Admin",
      role: "ADMIN",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("GET / returns key list", async () => {
    mockPrisma.apiKey.findMany.mockResolvedValueOnce([]);
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys");
    expect(res.status).toBe(200);
  });

  it("POST / creates key", async () => {
    mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "k1", key: "h" });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", spendLimitUsd: 5 }),
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ spendLimitUsd: 5 }),
      }),
    );
  });

  it("POST / returns 400 for empty name", async () => {
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / returns 400 for invalid spend limit", async () => {
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", spendLimitUsd: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:id revokes key", async () => {
    mockPrisma.apiKey.update.mockResolvedValueOnce({ id: "k1", key: "h", isActive: false });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/key-1", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("DELETE /:id returns 404 when the key does not exist", async () => {
    vi.mocked(revokeApiKey).mockRejectedValueOnce({ code: "P2025" });

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
  });

  it("DELETE /:id returns 500 for non-error failures", async () => {
    vi.mocked(revokeApiKey).mockRejectedValueOnce("failed");

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/key-1", { method: "DELETE" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
  });
});
