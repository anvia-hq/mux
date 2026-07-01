import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma, mockListAllModels, mockReloadProvider } = vi.hoisted(() => ({
  mockPrisma: {
    providerKey: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ provider: "custom-openai", lastFour: "abcd" }),
      upsert: vi
        .fn()
        .mockResolvedValue({ provider: "openai", lastFour: "abcd", updatedAt: new Date() }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customProvider: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [{ modelId: "custom-chat" }],
      }),
      update: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customProviderModel: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fallbackTarget: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    apiKey: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    disabledModel: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ modelId: "gpt-4", provider: "openai" }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "a@b.com",
        name: "Admin",
        role: "ADMIN",
        passwordHash: "h",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    $transaction: vi.fn((input) =>
      typeof input === "function" ? input(mockPrisma) : Promise.all(input),
    ),
  },
  mockListAllModels: vi.fn().mockReturnValue([]),
  mockReloadProvider: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/providers/registry", () => ({
  listAllModels: mockListAllModels,
  listPublicModels: vi.fn().mockResolvedValue([]),
  reloadProvider: mockReloadProvider,
  toPublicModelId: (provider: string, modelId: string) => `${provider}:${modelId}`,
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
vi.mock("../../../src/modules/providers/crypto", () => ({
  encrypt: vi.fn().mockReturnValue("enc"),
  lastFour: vi.fn().mockReturnValue("abcd"),
}));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt"),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("jwt"),
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));

import { providersRouter } from "../../../src/modules/providers/router";

describe("providers router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockPrisma.customProvider.findMany.mockResolvedValue([]);
    mockPrisma.customProvider.findUnique.mockResolvedValue(null);
  });

  it("GET / returns provider list", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([]);
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers");
    expect(res.status).toBe(200);
  });

  it("GET /catalog returns built-in and custom providers", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      {
        provider: "openai",
        lastFour: "abcd",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        updater: { email: "a@b.com" },
      },
      {
        provider: "custom-openai",
        lastFour: "wxyz",
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        updater: { email: "a@b.com" },
      },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([
      {
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [{ modelId: "custom-chat" }],
      },
    ]);

    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{ provider: string; name: string; type: string; configured: boolean }>;
    };
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "custom-openai",
          name: "Custom OpenAI",
          type: "custom",
          configured: true,
          modelCount: 1,
        }),
        expect.objectContaining({
          provider: "openai",
          type: "built-in",
          configured: true,
        }),
      ]),
    );
  });

  it("PUT /:name stores provider key", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test-key" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /custom creates a custom provider with models and key", async () => {
    mockPrisma.providerKey.findUnique.mockResolvedValueOnce(null);
    mockPrisma.customProvider.findUnique.mockResolvedValueOnce(null);
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        apiKey: "custom-key",
        models: [
          {
            id: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.customProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "custom-openai",
          models: expect.objectContaining({
            create: [
              expect.objectContaining({
                modelId: "custom-chat",
                reasoning: false,
                toolCall: true,
                structuredOutput: true,
              }),
            ],
          }),
        }),
      }),
    );
    expect(mockPrisma.providerKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: "custom-openai" }),
      }),
    );
    expect(mockReloadProvider).toHaveBeenCalledWith("custom-openai");
  });

  it("POST /custom defaults custom model capabilities when omitted", async () => {
    mockPrisma.providerKey.findUnique.mockResolvedValueOnce(null);
    mockPrisma.customProvider.findUnique.mockResolvedValueOnce(null);
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        apiKey: "custom-key",
        models: [
          {
            id: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text", "image", "pdf"],
            outputModalities: ["text"],
            weights: "closed",
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.customProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          models: expect.objectContaining({
            create: [
              expect.objectContaining({
                modelId: "custom-chat",
                reasoning: true,
                toolCall: true,
                structuredOutput: true,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it("PUT /:name keeps disabled model preferences", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test-key" }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.disabledModel.deleteMany).not.toHaveBeenCalled();
  });

  it("DELETE /:name removes provider key", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("DELETE /custom/:id removes custom provider data", async () => {
    mockPrisma.customProvider.findUnique.mockResolvedValueOnce({ id: "custom-openai" });
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/custom/custom-openai", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockPrisma.fallbackTarget.deleteMany).toHaveBeenCalledWith({
      where: { provider: "custom-openai" },
    });
    expect(mockPrisma.disabledModel.deleteMany).toHaveBeenCalledWith({
      where: { provider: "custom-openai" },
    });
    expect(mockPrisma.customProvider.deleteMany).toHaveBeenCalledWith({
      where: { id: "custom-openai" },
    });
    expect(mockReloadProvider).toHaveBeenCalledWith("custom-openai");
  });

  it("DELETE /:name keeps disabled model preferences", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockPrisma.disabledModel.deleteMany).not.toHaveBeenCalled();
  });

  it("GET /:name/models lists models", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai/models");
    expect(res.status).toBe(200);
  });

  it("PUT /:name/models/toggle toggles model", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai/models/toggle", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "gpt-4", enabled: false }),
    });
    expect(res.status).toBe(200);
  });

  it("PUT /:name/models replaces custom models and cleans removed references", async () => {
    mockPrisma.customProvider.findUnique.mockResolvedValueOnce({
      id: "custom-openai",
      models: [{ modelId: "old-chat" }, { modelId: "kept-chat" }],
    });
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/custom-openai/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [
          {
            id: "kept-chat",
            name: "Kept Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.customProviderModel.deleteMany).toHaveBeenCalledWith({
      where: { providerId: "custom-openai" },
    });
    expect(mockPrisma.customProviderModel.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          providerId: "custom-openai",
          modelId: "kept-chat",
          reasoning: false,
          toolCall: true,
          structuredOutput: true,
        }),
      ],
    });
    expect(mockPrisma.disabledModel.deleteMany).toHaveBeenCalledWith({
      where: { provider: "custom-openai", modelId: { in: ["old-chat"] } },
    });
    expect(mockPrisma.fallbackTarget.deleteMany).toHaveBeenCalledWith({
      where: { provider: "custom-openai", modelId: { in: ["old-chat"] } },
    });
    expect(mockReloadProvider).toHaveBeenCalledWith("custom-openai");
  });

  it("PUT /:name/models defaults omitted custom model capabilities", async () => {
    mockPrisma.customProvider.findUnique.mockResolvedValueOnce({
      id: "custom-openai",
      models: [{ modelId: "custom-chat" }],
    });
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/custom-openai/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [
          {
            id: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text", "image", "pdf"],
            outputModalities: ["text"],
            weights: "closed",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.customProviderModel.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          providerId: "custom-openai",
          modelId: "custom-chat",
          reasoning: true,
          toolCall: true,
          structuredOutput: true,
        }),
      ],
    });
    expect(mockReloadProvider).toHaveBeenCalledWith("custom-openai");
  });

  it("PUT /:name/models/enable-all enables all", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai/models/enable-all", { method: "PUT" });
    expect(res.status).toBe(200);
  });

  it("PUT /:name/models/disable-all disables all", async () => {
    mockListAllModels.mockReturnValueOnce([{ id: "gpt-4", provider: "openai" }]);
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai/models/disable-all", { method: "PUT" });
    expect(res.status).toBe(200);
  });
});
