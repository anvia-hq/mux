import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockValidateApiKey } = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn(),
}));

vi.mock("../../src/modules/keys/services", () => ({ validateApiKey: mockValidateApiKey }));

import { apiKeyAuth, readApiKeyModelAccess } from "../../src/middleware/api-key";

describe("api-key middleware", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no Authorization header", async () => {
    const app = new Hono();
    app.use("*", apiKeyAuth);
    app.get("/test", (c) => c.json({ ok: true }));
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid API key", async () => {
    mockValidateApiKey.mockResolvedValueOnce(null);
    const app = new Hono();
    app.use("*", apiKeyAuth);
    app.get("/test", (c) => c.json({ ok: true }));
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid-key" },
    });
    expect(res.status).toBe(401);
  });

  it("passes through with valid API key", async () => {
    mockValidateApiKey.mockResolvedValueOnce({ id: "key-1", name: "test-key" });
    const app = new Hono();
    app.use("*", apiKeyAuth);
    app.get("/test", (c) => c.json({ ok: true }));
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid-key" },
    });
    expect(res.status).toBe(200);
  });

  it("sets model access context for valid API keys", async () => {
    mockValidateApiKey.mockResolvedValueOnce({
      id: "key-1",
      name: "test-key",
      spendLimitUsd: null,
      allowAllModels: false,
      includeFutureModels: false,
      allowedModelIds: ["openai:gpt-4o"],
    });
    const app = new Hono();
    app.use("*", apiKeyAuth);
    app.get("/test", (c) => c.json(readApiKeyModelAccess(c)));
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid-key" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      allowAllModels: false,
      includeFutureModels: false,
      allowedModelIds: ["openai:gpt-4o"],
    });
  });
});
