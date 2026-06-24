import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockValidateApiKey } = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn(),
}));

vi.mock("../modules/keys/services", () => ({ validateApiKey: mockValidateApiKey }));

import { apiKeyAuth } from "./api-key";

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
});
