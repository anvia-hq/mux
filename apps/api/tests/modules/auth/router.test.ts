import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/modules/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt"),
  verify: vi.fn().mockResolvedValue({ sub: "user-1" }),
}));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

import { authRouter } from "../../../src/modules/auth/router";

describe("auth router", () => {
  afterEach(() => vi.clearAllMocks());

  it("GET /onboarding-status true", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(0);
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/onboarding-status");
    expect(await res.json()).toEqual({ needsOnboarding: true });
  });

  it("GET /onboarding-status false", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(3);
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/onboarding-status");
    expect(await res.json()).toEqual({ needsOnboarding: false });
  });

  it("POST /onboard creates first admin", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(0);
    mockPrisma.user.create.mockResolvedValueOnce({
      id: "1",
      email: "a@b.com",
      name: "Admin",
      role: "ADMIN",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.com", password: "password123", name: "Admin" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /onboard rejected when users exist", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(5);
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "password123" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /login success", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "1",
      email: "test@test.com",
      name: "Test",
      role: "USER",
      passwordHash: "hashed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com", password: "correct" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /login bad credentials", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@test.com", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /register is disabled", async () => {
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@test.com", password: "password123" }),
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "registration is disabled" });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("GET /me returns user", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@b.com",
      name: "U",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/me");
    expect(res.status).toBe(200);
  });

  it("POST /logout returns ok", async () => {
    const app = new Hono().route("/auth", authRouter);
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
