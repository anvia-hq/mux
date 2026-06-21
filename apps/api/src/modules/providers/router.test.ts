import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma, mockListAllModels, mockReloadProvider } = vi.hoisted(() => ({
  mockPrisma: {
    providerKey: {
      findMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ provider: "openai", lastFour: "abcd", updatedAt: new Date() }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    disabledModel: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ modelId: "gpt-4", provider: "openai" }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({
      id: "admin-1", email: "a@b.com", name: "Admin", role: "ADMIN",
      passwordHash: "h", createdAt: new Date(), updatedAt: new Date(),
    }) },
  },
  mockListAllModels: vi.fn().mockReturnValue([]),
  mockReloadProvider: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../providers/registry", () => ({ listAllModels: mockListAllModels, reloadProvider: mockReloadProvider }));
vi.mock("./crypto", () => ({ encrypt: vi.fn().mockReturnValue("enc"), lastFour: vi.fn().mockReturnValue("abcd") }));
vi.mock("hono/cookie", () => ({ getCookie: vi.fn().mockReturnValue("jwt"), setCookie: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("hono/jwt", () => ({ sign: vi.fn().mockResolvedValue("jwt"), verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }) }));

import { providersRouter } from "./router";

describe("providers router", () => {
  afterEach(() => vi.clearAllMocks());

  it("GET / returns provider list", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([]);
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers");
    expect(res.status).toBe(200);
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

  it("DELETE /:name removes provider key", async () => {
    const app = new Hono().route("/providers", providersRouter);
    const res = await app.request("/providers/openai", { method: "DELETE" });
    expect(res.status).toBe(200);
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