import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockListPublicNonAliasModels, mockPrisma, mockRequireRole } = vi.hoisted(() => ({
  mockListPublicNonAliasModels: vi.fn(),
  mockPrisma: {
    modelAlias: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockRequireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}));

vi.mock("../../../src/providers/registry", () => ({
  listPublicNonAliasModels: mockListPublicNonAliasModels,
  toPublicModelIdForModel: (model: { id: string; provider: string; type?: string }) =>
    model.type === "alias" ? model.id : `${model.provider}:${model.id}`,
}));
vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/modules/auth/services", () => ({
  requireRole: mockRequireRole,
}));

import { modelAliasesRouter } from "../../../src/modules/model-aliases/router";

function createApp() {
  return new Hono().route("/model-aliases", modelAliasesRouter);
}

function aliasRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "fast-chat",
    name: "Fast chat",
    description: null,
    targetModelId: "openai:gpt-4o",
    enabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("model aliases router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("rejects non-admin users", async () => {
    mockRequireRole.mockResolvedValueOnce(null);

    const res = await createApp().request("/model-aliases");

    expect(res.status).toBe(403);
  });

  it("GET / returns model aliases with target availability", async () => {
    mockPrisma.modelAlias.findMany.mockResolvedValueOnce([aliasRow()]);
    mockListPublicNonAliasModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);

    const res = await createApp().request("/model-aliases");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: "fast-chat", targetModelId: "openai:gpt-4o", targetAvailable: true }],
    });
  });

  it("POST / creates an alias for a validated non-alias target", async () => {
    mockListPublicNonAliasModels
      .mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }])
      .mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
    mockPrisma.modelAlias.findUnique.mockResolvedValueOnce(null);
    mockPrisma.modelAlias.create.mockImplementationOnce(async ({ data }) => aliasRow(data));

    const res = await createApp().request("/model-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        targetModelId: "openai:gpt-4o",
        enabled: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.modelAlias.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "fast-chat", targetModelId: "openai:gpt-4o" }),
      }),
    );
  });

  it("POST / rejects alias-to-alias style targets", async () => {
    const res = await createApp().request("/model-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        targetModelId: "other-alias",
        enabled: true,
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "targetModelId must reference a provider model or fallback group",
    });
  });

  it("POST / rejects unknown targets", async () => {
    mockListPublicNonAliasModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);

    const res = await createApp().request("/model-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        targetModelId: "anthropic:claude",
        enabled: true,
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "unknown or unavailable alias target: anthropic:claude",
    });
  });

  it("POST / rejects duplicate alias ids", async () => {
    mockListPublicNonAliasModels.mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
    mockPrisma.modelAlias.findUnique.mockResolvedValueOnce(aliasRow());

    const res = await createApp().request("/model-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        targetModelId: "openai:gpt-4o",
        enabled: true,
      }),
    });

    expect(res.status).toBe(409);
  });

  it("PUT /:id updates an existing alias", async () => {
    mockListPublicNonAliasModels
      .mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }])
      .mockResolvedValueOnce([{ id: "gpt-4o", provider: "openai" }]);
    mockPrisma.modelAlias.findUnique.mockResolvedValueOnce(aliasRow());
    mockPrisma.modelAlias.update.mockImplementationOnce(async ({ data }) => aliasRow(data));

    const res = await createApp().request("/model-aliases/fast-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fast chat",
        description: null,
        targetModelId: "openai:gpt-4o",
        enabled: false,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      alias: { id: "fast-chat", enabled: false },
    });
  });

  it("DELETE /:id deletes the alias", async () => {
    mockPrisma.modelAlias.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await createApp().request("/model-aliases/fast-chat", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockPrisma.modelAlias.deleteMany).toHaveBeenCalledWith({
      where: { id: "fast-chat" },
    });
  });
});
