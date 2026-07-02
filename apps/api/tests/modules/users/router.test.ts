import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@test.com",
        name: "Admin",
        role: "ADMIN",
        passwordHash: "hash",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
  },
}));

vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt-token"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt-token"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));

vi.mock("../../../src/utils/prisma", () => ({
  prisma: mockPrisma,
}));

import { usersRouter } from "../../../src/modules/users/router";

describe("users router", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET / returns users list for admin", async () => {
    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body).toHaveProperty("users");
  });

  it("GET / returns 403 for non-admin users", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "hash",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("POST /:id/promote promotes users for admins", async () => {
    const date = new Date();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: "admin-1",
        email: "admin@test.com",
        name: "Admin",
        role: "ADMIN",
        passwordHash: "hash",
        createdAt: date,
        updatedAt: date,
      })
      .mockResolvedValueOnce({
        id: "user-1",
        email: "user@test.com",
        name: "User",
        role: "USER",
        passwordHash: "hash",
        spendLimitUsd: null,
        createdAt: date,
        updatedAt: date,
      });
    mockPrisma.user.update.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "ADMIN",
      passwordHash: "hash",
      spendLimitUsd: null,
      createdAt: date,
      updatedAt: date,
    });

    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users/user-1/promote", { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ id: "user-1", role: "ADMIN" });
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADMIN" },
    });
  });

  it("POST /:id/promote returns 403 for non-admin users", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "hash",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users/user-2/promote", { method: "POST" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("POST /:id/promote returns 404 for missing users", async () => {
    const date = new Date();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: "admin-1",
        email: "admin@test.com",
        name: "Admin",
        role: "ADMIN",
        passwordHash: "hash",
        createdAt: date,
        updatedAt: date,
      })
      .mockResolvedValueOnce(null);

    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users/missing-user/promote", { method: "POST" });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "user not found" });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("POST /:id/promote is idempotent for existing admins", async () => {
    const date = new Date();
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({
        id: "admin-1",
        email: "admin@test.com",
        name: "Admin",
        role: "ADMIN",
        passwordHash: "hash",
        createdAt: date,
        updatedAt: date,
      })
      .mockResolvedValueOnce({
        id: "admin-2",
        email: "other-admin@test.com",
        name: "Other Admin",
        role: "ADMIN",
        passwordHash: "hash",
        spendLimitUsd: null,
        createdAt: date,
        updatedAt: date,
      });

    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users/admin-2/promote", { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ id: "admin-2", role: "ADMIN" });
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
