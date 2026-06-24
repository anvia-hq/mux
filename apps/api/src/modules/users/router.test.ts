import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt-token"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt-token"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));

vi.mock("../../utils/prisma", () => ({
  prisma: {
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
    },
  },
}));

import { usersRouter } from "./router";

describe("users router", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET / returns users list for admin", async () => {
    const app = new Hono().route("/users", usersRouter);
    const res = await app.request("/users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("users");
  });
});
