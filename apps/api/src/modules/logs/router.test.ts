import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    requestLog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "user@test.com",
        name: "User",
        role: "USER",
        passwordHash: "hash",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt-token"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt-token"),
  verify: vi.fn().mockResolvedValue({ sub: "user-1", role: "USER" }),
}));

const { mockGetCurrentUser } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
}));

vi.mock("../auth/services", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

import { logsRouter } from "./router";

describe("logs router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "hash",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  beforeEach(() => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "hash",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("GET / returns paginated logs", async () => {
    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("logs");
  });

  it("GET / rejects unauthenticated users", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs");

    expect(res.status).toBe(401);
  });

  it("GET / forwards parsed filters and ignores invalid numbers and dates", async () => {
    mockPrisma.requestLog.findMany.mockResolvedValueOnce([]);
    mockPrisma.requestLog.count.mockResolvedValueOnce(0);

    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request(
      "/logs?apiKeyId=key-1&provider=openai&model=gpt-4&startDate=2026-01-01&endDate=bad&limit=25&offset=-1",
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.requestLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 25,
        where: expect.objectContaining({
          apiKeyId: "key-1",
          provider: "openai",
          model: "gpt-4",
          createdAt: expect.objectContaining({ gte: new Date("2026-01-01") }),
        }),
      }),
    );
  });

  it("GET / returns service errors", async () => {
    mockPrisma.requestLog.findMany.mockRejectedValueOnce(new Error("logs failed"));

    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "logs failed" });
  });

  it("GET /stats returns aggregate stats", async () => {
    mockPrisma.requestLog.count.mockResolvedValueOnce(0);
    mockPrisma.requestLog.aggregate
      .mockResolvedValueOnce({ _sum: { totalTokens: null } })
      .mockResolvedValueOnce({ _sum: { estimatedCost: null } });
    mockPrisma.requestLog.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs/stats?days=30&provider=openai&model=gpt-4");
    expect(res.status).toBe(200);
    expect(mockPrisma.requestLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ provider: "openai", model: "gpt-4" }),
    });
  });

  it("GET /stats forwards dates, days, and valid groupBy", async () => {
    mockPrisma.requestLog.count.mockResolvedValueOnce(0);
    mockPrisma.requestLog.aggregate
      .mockResolvedValueOnce({ _sum: { totalTokens: null } })
      .mockResolvedValueOnce({ _sum: { estimatedCost: null } });
    mockPrisma.requestLog.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request(
      "/logs/stats?startDate=2026-01-01&endDate=2026-01-31&days=7&groupBy=apiKey",
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.requestLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        createdAt: expect.objectContaining({
          gte: new Date("2026-01-01"),
          lte: new Date("2026-01-31"),
        }),
      }),
    });
  });

  it("GET /stats ignores invalid groupBy and returns service errors", async () => {
    mockPrisma.requestLog.count.mockRejectedValueOnce("failed");

    const app = new Hono().route("/logs", logsRouter);
    const res = await app.request("/logs/stats?groupBy=unknown&days=bad");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
  });
});
