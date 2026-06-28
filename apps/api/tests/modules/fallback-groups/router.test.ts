import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockListAllModels, mockPrisma, mockRequireRole } = vi.hoisted(() => ({
  mockListAllModels: vi.fn(),
  mockPrisma: {
    fallbackGroup: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    fallbackTarget: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockRequireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}));

vi.mock("../../../src/providers/registry", () => ({
  listAllModels: mockListAllModels,
  toFallbackGroupModelId: (groupId: string) => `mux:${groupId}`,
}));
vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/modules/auth/services", () => ({
  requireRole: mockRequireRole,
}));

import { fallbackGroupsRouter } from "../../../src/modules/fallback-groups/router";

describe("fallback groups router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("rejects non-admin users", async () => {
    mockRequireRole.mockResolvedValueOnce(null);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups");

    expect(res.status).toBe(403);
  });

  it("GET / returns fallback groups", async () => {
    mockPrisma.fallbackGroup.findMany.mockResolvedValueOnce([
      {
        id: "fast-chat",
        name: "Fast chat",
        description: null,
        enabled: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        targets: [{ provider: "openai", modelId: "gpt-4", position: 1 }],
      },
    ]);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [
        {
          id: "fast-chat",
          publicModelId: "mux:fast-chat",
          targets: [{ publicModelId: "openai:gpt-4" }],
        },
      ],
    });
  });

  it("POST / creates a validated fallback group", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce(null);
    mockPrisma.fallbackGroup.create.mockImplementationOnce(async ({ data }) => ({
      ...data,
      description: data.description ?? null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      targets: data.targets.create,
    }));

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        enabled: true,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.fallbackGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "fast-chat" }),
      }),
    );
  });

  it("POST / rejects unknown targets", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        enabled: true,
        targets: [{ provider: "anthropic", modelId: "claude" }],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "unknown or unconfigured fallback target: anthropic:claude",
    });
  });

  it("POST / rejects duplicate targets", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        enabled: true,
        targets: [
          { provider: "openai", modelId: "gpt-4" },
          { provider: "openai", modelId: "gpt-4" },
        ],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "duplicate fallback target: openai:gpt-4",
    });
  });

  it("POST / rejects duplicate group ids", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({ id: "fast-chat" });

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "fast-chat",
        name: "Fast chat",
        enabled: true,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    });

    expect(res.status).toBe(409);
  });

  it("POST / validates body shape", async () => {
    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "-bad-", name: "", targets: [] }),
    });

    expect(res.status).toBe(400);
  });

  it("PUT /:id updates an existing group inside a transaction", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({ id: "fast-chat" });
    mockPrisma.$transaction.mockImplementationOnce(async (fn) =>
      fn({
        fallbackTarget: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        fallbackGroup: {
          update: vi.fn().mockImplementation(async ({ where, data }) => ({
            id: where.id,
            name: data.name,
            description: data.description,
            enabled: data.enabled,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
            targets: data.targets.create,
          })),
        },
      }),
    );

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups/fast-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fast chat",
        description: null,
        enabled: false,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      group: { id: "fast-chat", enabled: false, targets: [{ position: 1 }] },
    });
  });

  it("PUT /:id returns 404 for missing groups", async () => {
    mockListAllModels.mockReturnValueOnce([{ provider: "openai", id: "gpt-4" }]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce(null);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups/fast-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fast chat",
        enabled: true,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    });

    expect(res.status).toBe(404);
  });

  it("PUT /:id rejects invalid targets before updating", async () => {
    mockListAllModels.mockReturnValueOnce([]);

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups/fast-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fast chat",
        enabled: true,
        targets: [{ provider: "openai", modelId: "gpt-4" }],
      }),
    });

    expect(res.status).toBe(400);
  });

  it("DELETE /:id deletes the group", async () => {
    mockPrisma.fallbackGroup.deleteMany.mockResolvedValueOnce({ count: 1 });

    const app = new Hono().route("/fallback-groups", fallbackGroupsRouter);
    const res = await app.request("/fallback-groups/fast-chat", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockPrisma.fallbackGroup.deleteMany).toHaveBeenCalledWith({
      where: { id: "fast-chat" },
    });
  });
});
