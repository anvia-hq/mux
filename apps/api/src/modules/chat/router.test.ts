import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAssertApiKeyCanSpend, mockFlushLogBuffer, mockHandleChatCompletion, mockSpendLimit } =
  vi.hoisted(() => ({
    mockAssertApiKeyCanSpend: vi.fn(),
    mockFlushLogBuffer: vi.fn().mockResolvedValue(undefined),
    mockHandleChatCompletion: vi.fn(),
    mockSpendLimit: { value: null as number | null },
  }));

vi.mock("./services", () => {
  class ApiKeyUnbillableUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableUsageError";
    }
  }

  return { ApiKeyUnbillableUsageError, handleChatCompletion: mockHandleChatCompletion };
});
vi.mock("../../middleware/api-key", () => ({
  apiKeyAuth: vi
    .fn()
    .mockImplementation(
      async (c: { set: (key: string, value: unknown) => void }, next: () => void) => {
        c.set("apiKeyId", "key-1");
        c.set("apiKeySpendLimitUsd", mockSpendLimit.value);
        await next();
      },
    ),
}));
vi.mock("../../middleware/logger", () => ({
  flushLogBuffer: mockFlushLogBuffer,
  logRequest: vi.fn(),
}));
vi.mock("../keys/services", () => {
  class ApiKeySpendLimitExceededError extends Error {
    constructor() {
      super("API key spend limit exceeded");
      this.name = "ApiKeySpendLimitExceededError";
    }
  }

  return {
    ApiKeySpendLimitExceededError,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
  };
});

import { Hono } from "hono";
import { chatRouter } from "./router";
import { ApiKeyUnbillableUsageError } from "./services";
import { ApiKeySpendLimitExceededError } from "../keys/services";

describe("chat router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSpendLimit.value = null;
  });

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
    mockHandleChatCompletion.mockRejectedValueOnce(
      new Error("No provider found for model: unknown"),
    );
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
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: false,
    });
  });

  it("POST /completions checks spend limit before limited request", async () => {
    mockSpendLimit.value = 10;
    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "c1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(mockFlushLogBuffer).toHaveBeenCalled();
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleChatCompletion).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: true,
    });
  });

  it("POST /completions 429 when spend limit is exhausted", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions 429 for limited streaming request", async () => {
    mockSpendLimit.value = 10;
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(429);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions 429 when limited request cannot be billed", async () => {
    mockSpendLimit.value = 10;
    mockHandleChatCompletion.mockRejectedValueOnce(new ApiKeyUnbillableUsageError());
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(429);
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
