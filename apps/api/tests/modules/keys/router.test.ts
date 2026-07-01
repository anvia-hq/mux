import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    apiKey: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    requestLog: { groupBy: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

const { mockListPublicModels } = vi.hoisted(() => ({
  mockListPublicModels: vi.fn(),
}));

const { mockDecrypt, mockEncrypt } = vi.hoisted(() => ({
  mockDecrypt: vi.fn((value: string) => value.replace(/^encrypted:/, "")),
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/providers/registry", () => ({
  listPublicModels: mockListPublicModels,
  toPublicModelId: (provider: string, modelId: string) => `${provider}:${modelId}`,
  toPublicModelIdForModel: (model: { id: string; provider: string; type?: string }) =>
    model.type === "alias" ? model.id : `${model.provider}:${model.id}`,
}));
vi.mock("../../../src/modules/providers/crypto", () => ({
  decrypt: mockDecrypt,
  encrypt: mockEncrypt,
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("../../../src/utils/cache", () => ({
  cacheDelete: vi.fn().mockResolvedValue(undefined),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/utils/redis", () => ({
  redis: {
    get: vi.fn(),
    incrbyfloat: vi.fn(),
  },
}));

import { keysRouter } from "../../../src/modules/keys/router";
import { revokeApiKey } from "../../../src/modules/keys/services";

vi.mock("../../../src/modules/keys/services", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/modules/keys/services")>();
  return {
    ...original,
    revokeApiKey: vi.fn(original.revokeApiKey),
  };
});

describe("keys router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockListPublicModels.mockReset();
  });

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

  it("GET / returns only owned keys for regular users", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.apiKey.findMany.mockResolvedValueOnce([]);

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys");

    expect(res.status).toBe(200);
    expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdBy: "user-1" } }),
    );
  });

  it("POST / creates key", async () => {
    mockListPublicModels.mockResolvedValueOnce([
      { id: "gpt-4o", provider: "openai" },
      { id: "fast", provider: "mux" },
    ]);
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
        data: expect.objectContaining({
          spendLimitUsd: 5,
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o", "mux:fast"],
        }),
      }),
    );
  });

  it("POST / creates future-access key only when requested", async () => {
    mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "k1", key: "h" });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", includeFutureModels: true }),
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowAllModels: true,
          includeFutureModels: true,
          allowedModelIds: [],
        }),
      }),
    );
  });

  it("POST / creates filtered key", async () => {
    mockListPublicModels.mockResolvedValueOnce([
      { id: "gpt-4o", provider: "openai" },
      { id: "fast", provider: "mux" },
    ]);
    mockPrisma.apiKey.create.mockResolvedValueOnce({ id: "k1", key: "h" });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test",
        allowedModelIds: ["openai:gpt-4o", "mux:fast"],
      }),
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o", "mux:fast"],
        }),
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

  it("POST / rejects regular users", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    expect(res.status).toBe(403);
    expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
  });

  it("GET /:id/reveal returns raw key for owners", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
      createdBy: "user-1",
      isActive: true,
      keyCiphertext: "encrypted:mux_live_saved",
    });

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/k1/reveal");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ key: "mux_live_saved" });
  });

  it("GET /:id/reveal returns 404 or 409 for known failures", async () => {
    const app = new Hono().route("/api-keys", keysRouter);

    mockPrisma.apiKey.findUnique.mockResolvedValueOnce(null);
    expect((await app.request("/api-keys/missing/reveal")).status).toBe(404);

    mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
      createdBy: "admin-1",
      isActive: true,
      keyCiphertext: null,
    });
    expect((await app.request("/api-keys/k1/reveal")).status).toBe(409);
  });

  it("POST /:id/rotate regenerates raw key for owners", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
      createdBy: "user-1",
      isActive: true,
      key: "old-hash",
    });
    mockPrisma.apiKey.update.mockResolvedValueOnce({ id: "k1" });

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/k1/rotate", { method: "POST" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ key: expect.stringMatching(/^mux_live_/) });
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "k1" },
        data: expect.objectContaining({
          keyCiphertext: expect.stringMatching(/^encrypted:mux_live_/),
        }),
      }),
    );
  });

  it("POST /:id/rotate returns 404 for non-owner users", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-2",
      email: "user@test.com",
      name: "User",
      role: "USER",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.apiKey.findUnique.mockResolvedValueOnce({
      createdBy: "user-1",
      isActive: true,
      key: "old-hash",
    });

    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/k1/rotate", { method: "POST" });

    expect(res.status).toBe(404);
    expect(mockPrisma.apiKey.update).not.toHaveBeenCalled();
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

  it("POST / returns 400 for empty model filters", async () => {
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", allowedModelIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / returns 400 for unknown model filters", async () => {
    mockListPublicModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", allowedModelIds: ["anthropic:claude"] }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "unknown or unavailable model(s): anthropic:claude",
    });
  });

  it("PATCH /:id/model-access updates selected model access", async () => {
    mockListPublicModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
    mockPrisma.apiKey.update.mockResolvedValueOnce({ key: "hashed-key" });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/k1/model-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "selected", allowedModelIds: ["openai:gpt-4o"] }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "k1" },
        data: {
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o"],
        },
      }),
    );
  });

  it("PATCH /:id/model-access returns 404 when the key does not exist", async () => {
    mockPrisma.apiKey.update.mockRejectedValueOnce({ code: "P2025" });
    const app = new Hono().route("/api-keys", keysRouter);
    const res = await app.request("/api-keys/missing/model-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "future" }),
    });

    expect(res.status).toBe(404);
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
