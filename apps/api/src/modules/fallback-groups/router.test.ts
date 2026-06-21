import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockListAllModels, mockPrisma } = vi.hoisted(() => ({
  mockListAllModels: vi.fn(),
  mockPrisma: {
    fallbackGroup: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    fallbackTarget: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../providers/registry", () => ({
  listAllModels: mockListAllModels,
  toFallbackGroupModelId: (groupId: string) => `mux:${groupId}`,
}));
vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../auth/services", () => ({
  requireRole: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}));

import { fallbackGroupsRouter } from "./router";

describe("fallback groups router", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
});
