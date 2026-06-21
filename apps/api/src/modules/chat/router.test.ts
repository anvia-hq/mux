import { afterEach, describe, expect, it, vi } from "vitest";

const { mockHandleChatCompletion } = vi.hoisted(() => ({
  mockHandleChatCompletion: vi.fn(),
}));

vi.mock("./services", () => ({ handleChatCompletion: mockHandleChatCompletion }));
vi.mock("../../middleware/api-key", () => ({
  apiKeyAuth: vi.fn().mockImplementation(async (_c: unknown, next: () => void) => { await next(); }),
}));
vi.mock("../../middleware/logger", () => ({ logRequest: vi.fn() }));

import { Hono } from "hono";
import { chatRouter } from "./router";
import { logRequest } from "../../middleware/logger";

describe("chat router", () => {
  afterEach(() => vi.clearAllMocks());

  it("POST /completions 400 invalid json", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", { method: "POST", body: "bad" });
    expect(res.status).toBe(400);
  });

  it("POST /completions 400 missing model", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /completions 400 empty messages", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /completions 404 no provider", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(new Error("No provider found for model: unknown"));
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "unknown", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /completions 200 success", async () => {
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: { id: "c1", model: "gpt-4", choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /completions 500 generic error", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(new Error("Something broke"));
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(500);
  });
});