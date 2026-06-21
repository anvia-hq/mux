import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockListPublicModels, mockPrisma } = vi.hoisted(() => ({
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
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "admin-1",
    email: "admin@test.com",
    name: "Admin",
    role: "ADMIN",
  }),
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
});
