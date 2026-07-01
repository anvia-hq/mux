import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockGetCurrentUser, mockListPublicModels, mockModelAccess, mockPrisma } = vi.hoisted(
  () => ({
    mockGetCurrentUser: vi.fn().mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      name: "Admin",
      role: "ADMIN",
    }),
    mockListPublicModels: vi.fn().mockResolvedValue([]),
    mockModelAccess: {
      allowAllModels: true,
      includeFutureModels: true,
      allowedModelIds: [] as string[],
    },
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
  }),
);

vi.mock("../../../src/providers/registry", () => ({
  listPublicModels: mockListPublicModels,
  toPublicModelId: (provider: string, modelId: string) => `${provider}:${modelId}`,
}));
vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt-token"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt-token"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));
vi.mock("../../../src/modules/auth/services", () => ({
  getCurrentUser: mockGetCurrentUser,
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1" }),
}));
vi.mock("../../../src/modules/keys/services", () => ({
  isModelAllowedForApiKey: (
    modelId: string,
    access: { allowAllModels: boolean; allowedModelIds: string[] },
  ) => access.allowAllModels || access.allowedModelIds.includes(modelId),
}));

vi.mock("../../../src/middleware/api-key", () => ({
  apiKeyAuth: vi
    .fn()
    .mockImplementation(
      async (c: { set: (key: string, value: unknown) => void }, next: () => void) => {
        c.set("apiKeyAllowAllModels", mockModelAccess.allowAllModels);
        c.set("apiKeyIncludeFutureModels", mockModelAccess.includeFutureModels);
        c.set("apiKeyAllowedModelIds", mockModelAccess.allowedModelIds);
        await next();
      },
    ),
  readApiKeyModelAccess: vi.fn(() => mockModelAccess),
}));

import { modelsRouter, modelsDashboardRouter } from "../../../src/modules/models/router";

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
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
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

  it("GET /v1/models returns only allowed models for filtered keys", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];
    mockListPublicModels.mockResolvedValueOnce([
      {
        id: "gpt-4o",
        name: "GPT-4o",
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
      {
        id: "claude",
        name: "Claude",
        provider: "anthropic",
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
      data: [{ id: "openai:gpt-4o", owned_by: "openai" }],
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
