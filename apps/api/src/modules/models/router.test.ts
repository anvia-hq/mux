import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockGetCurrentUser, mockListPublicModels, mockPrisma } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn().mockResolvedValue({
    id: "admin-1",
    email: "admin@test.com",
    name: "Admin",
    role: "ADMIN",
  }),
  mockListPublicModels: vi.fn().mockResolvedValue([]),
  mockPrisma: {
    disabledModel: { findMany: vi.fn().mockResolvedValue([]) },
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
    },
  },
}));

vi.mock("../../providers/registry", () => ({
  listPublicModels: mockListPublicModels,
  toPublicModelId: (provider: string, modelId: string) => `${provider}:${modelId}`,
}));
vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt-token"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt-token"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));
vi.mock("../auth/services", () => ({
  getCurrentUser: mockGetCurrentUser,
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1" }),
}));

vi.mock("../../middleware/api-key", () => ({
  apiKeyAuth: vi.fn().mockImplementation(async (_c: unknown, next: () => void) => {
    await next();
  }),
}));

import { modelsRouter, modelsDashboardRouter } from "./router";

describe("models router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      name: "Admin",
      role: "ADMIN",
    });
    mockListPublicModels.mockResolvedValue([]);
  });

  it("GET /v1/models returns model list", async () => {
    mockListPublicModels.mockResolvedValueOnce([
      {
        id: "gpt-4",
        name: "GPT-4",
        provider: "openai",
        inputPricePer1M: 10,
        outputPricePer1M: 30,
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputModalities: ["text"],
        outputModalities: ["text"],
        reasoning: true,
        toolCall: true,
        structuredOutput: false,
        weights: "closed",
      },
    ]);
    const app = new Hono().route("/v1/models", modelsRouter);
    const res = await app.request("/v1/models", {
      headers: { Authorization: "Bearer valid-key" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: "openai:gpt-4", owned_by: "openai" }],
    });
  });

  it("GET /dashboard/models returns model list", async () => {
    mockListPublicModels.mockResolvedValueOnce([
      {
        id: "gpt-4",
        name: "GPT-4",
        provider: "openai",
        inputPricePer1M: 10,
        outputPricePer1M: 30,
        contextWindow: 8192,
        maxOutputTokens: 4096,
        inputModalities: ["text"],
        outputModalities: ["text"],
        reasoning: true,
        toolCall: true,
        structuredOutput: false,
        weights: "closed",
      },
    ]);
    const app = new Hono().route("/dashboard/models", modelsDashboardRouter);
    const res = await app.request("/dashboard/models");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: "openai:gpt-4", provider: "openai" }],
    });
  });

  it("GET /v1/models returns provider errors", async () => {
    mockListPublicModels.mockRejectedValueOnce(new Error("provider registry failed"));

    const app = new Hono().route("/v1/models", modelsRouter);
    const res = await app.request("/v1/models", {
      headers: { Authorization: "Bearer valid-key" },
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "provider registry failed" });
  });

  it("GET /v1/models handles non-error failures", async () => {
    mockListPublicModels.mockRejectedValueOnce("failed");

    const app = new Hono().route("/v1/models", modelsRouter);
    const res = await app.request("/v1/models", {
      headers: { Authorization: "Bearer valid-key" },
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Internal server error" });
  });

  it("GET /dashboard/models requires a session user", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const app = new Hono().route("/dashboard/models", modelsDashboardRouter);
    const res = await app.request("/dashboard/models");

    expect(res.status).toBe(401);
  });

  it("GET /dashboard/models returns registry errors", async () => {
    mockListPublicModels.mockRejectedValueOnce(new Error("dashboard registry failed"));

    const app = new Hono().route("/dashboard/models", modelsDashboardRouter);
    const res = await app.request("/dashboard/models");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "dashboard registry failed" });
  });
});
