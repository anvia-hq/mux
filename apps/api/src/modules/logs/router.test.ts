import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn(), groupBy: vi.fn() },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1", email: "user@test.com", name: "User", role: "USER",
        passwordHash: "hash", createdAt: new Date(), updatedAt: new Date(),
      }),
    },
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/cookie", () => ({ getCookie: vi.fn().mockReturnValue("jwt-token"), setCookie: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("hono/jwt", () => ({ sign: vi.fn().mockResolvedValue("jwt-token"), verify: vi.fn().mockResolvedValue({ sub: "user-1", role: "USER" }) }));

import { logsRouter } from "./router";

describe("logs router", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET / returns paginated logs", async () => {
    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("logs");
  });

  it("GET /stats returns aggregate stats", async () => {
    mockPrisma.requestLog.count.mockResolvedValueOnce(0);
    mockPrisma.requestLog.aggregate
      .mockResolvedValueOnce({ _sum: { totalTokens: null } })
      .mockResolvedValueOnce({ _sum: { estimatedCost: null } });
    mockPrisma.requestLog.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs/stats");
    expect(res.status).toBe(200);
  });
});