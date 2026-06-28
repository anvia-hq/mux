import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleChatCompletion,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleChatCompletion: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/chat/services", () => {
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
vi.mock("../../../src/middleware/api-key", () => ({
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
vi.mock("../../../src/middleware/logger", () => {
  class RequestLoggingUnavailableError extends Error {
    constructor() {
      super("request logging unavailable");
      this.name = "RequestLoggingUnavailableError";
    }
  }

  return {
    RequestLoggingUnavailableError,
    logStreamFinal: mockLogStreamFinal,
    logStreamStart: mockLogStreamStart,
  };
});
vi.mock("../../../src/providers/registry", () => ({ estimateCost: mockEstimateCost }));
vi.mock("../../../src/providers/chat-compat", () => {
  class UnsupportedChatFeatureError extends Error {
    constructor() {
      super("Model x does not support requested feature(s): structuredOutput");
      this.name = "UnsupportedChatFeatureError";
    }
  }

  return {
    UnsupportedChatFeatureError,
    validateChatCompletionRequestShape: vi.fn(
      (body: { model?: string; messages?: { role?: string; tool_call_id?: string }[] }) => {
        if (!body.model) return "request must include a model";
        if (!Array.isArray(body.messages) || body.messages.length === 0)
          return "request must include a non-empty messages array";
        const toolMessage = body.messages?.find((message) => message.role === "tool");
        return toolMessage && typeof toolMessage.tool_call_id !== "string"
          ? "messages[0].tool_call_id is required for tool messages"
          : null;
      },
    ),
  };
});
vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeySpendLimitExceededError extends Error {
    constructor() {
      super("API key spend limit exceeded");
      this.name = "ApiKeySpendLimitExceededError";
    }
  }
  class ApiKeySpendLedgerUnavailableError extends Error {
    constructor() {
      super("API key spend ledger unavailable");
      this.name = "ApiKeySpendLedgerUnavailableError";
    }
  }

  return {
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
  };
});

import { Hono } from "hono";
import { chatRouter } from "../../../src/modules/chat/router";
import { ApiKeyUnbillableUsageError } from "../../../src/modules/chat/services";
import { RequestLoggingUnavailableError } from "../../../src/middleware/logger";
import {
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../../../src/modules/keys/services";
import { UnsupportedChatFeatureError } from "../../../src/providers/chat-compat";

describe("chat router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockLogStreamStart.mockResolvedValue("log-1");
    mockLogStreamFinal.mockResolvedValue(undefined);
    mockEstimateCost.mockReturnValue(0.01);
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it("POST /completions 400 malformed tool message", async () => {
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "tool", content: "ok" }] }),
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

  it("POST /completions pre-enqueues and finalizes streaming logs", async () => {
    async function* chunks() {
      yield {
        id: "chunk-1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    }

    mockHandleChatCompletion.mockResolvedValueOnce({
      kind: "stream",
      stream: chunks(),
      provider: "openai",
      model: "gpt-4",
      responseModel: "gpt-4",
      startTime: Date.now(),
    });

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

    expect(res.status).toBe(200);
    await res.text();
    expect(mockLogStreamStart).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", model: "gpt-4", statusCode: 102 }),
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /completions 503 when request logging is unavailable", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
  });

  it("POST /completions 503 when spend ledger is unavailable", async () => {
    mockSpendLimit.value = 10;
    mockAssertApiKeyCanSpend.mockRejectedValueOnce(
      new ApiKeySpendLedgerUnavailableError(new Error()),
    );
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    expect(mockHandleChatCompletion).not.toHaveBeenCalled();
  });

  it("POST /completions 422 when requested features are unsupported", async () => {
    mockHandleChatCompletion.mockRejectedValueOnce(
      new UnsupportedChatFeatureError("anthropic:claude", ["structuredOutput"]),
    );
    const app = new Hono().route("/v1/chat", chatRouter);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic:claude",
        messages: [{ role: "user", content: "hi" }],
        response_format: { type: "json_object" },
      }),
    });
    expect(res.status).toBe(422);
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
