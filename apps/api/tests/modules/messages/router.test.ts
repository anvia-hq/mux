import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleAnthropicMessage,
  mockHandleAnthropicMessageTokenCount,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockModelAccess,
  mockResolveAnthropicMessageTokenCountAccessModelId,
  mockResolveAnthropicMessagesAccessModelId,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleAnthropicMessage: vi.fn(),
  mockHandleAnthropicMessageTokenCount: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockModelAccess: {
    allowAllModels: true,
    includeFutureModels: true,
    allowedModelIds: [] as string[],
  },
  mockResolveAnthropicMessageTokenCountAccessModelId: vi.fn(),
  mockResolveAnthropicMessagesAccessModelId: vi.fn(),
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("../../../src/modules/messages/services", () => {
  class ApiKeyUnbillableAnthropicMessageUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableAnthropicMessageUsageError";
    }
  }

  return {
    ApiKeyUnbillableAnthropicMessageUsageError,
    handleAnthropicMessage: mockHandleAnthropicMessage,
    handleAnthropicMessageTokenCount: mockHandleAnthropicMessageTokenCount,
  };
});

vi.mock("../../../src/middleware/api-key", () => ({
  apiKeyAuthWithAnthropicHeader: vi.fn().mockImplementation(
    async (
      c: {
        req: { header: (name: string) => string | undefined };
        json: (body: unknown, status: number) => Response;
        set: (key: string, value: unknown) => void;
      },
      next: () => void,
    ) => {
      if (!c.req.header("Authorization")?.startsWith("Bearer ") && !c.req.header("x-api-key")) {
        return c.json({ error: "missing or invalid API key header" }, 401);
      }
      c.set("apiKeyId", "key-1");
      c.set("apiKeySpendLimitUsd", mockSpendLimit.value);
      c.set("apiKeyAllowAllModels", mockModelAccess.allowAllModels);
      c.set("apiKeyIncludeFutureModels", mockModelAccess.includeFutureModels);
      c.set("apiKeyAllowedModelIds", mockModelAccess.allowedModelIds);
      await next();
    },
  ),
  readApiKeyModelAccess: vi.fn(() => mockModelAccess),
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

vi.mock("../../../src/providers/registry", () => ({
  estimateCost: mockEstimateCost,
  resolveAnthropicMessageTokenCountAccessModelId:
    mockResolveAnthropicMessageTokenCountAccessModelId,
  resolveAnthropicMessagesAccessModelId: mockResolveAnthropicMessagesAccessModelId,
}));

vi.mock("../../../src/modules/keys/services", () => {
  class ApiKeyModelAccessDeniedError extends Error {
    constructor(modelId: string) {
      super(`API key is not allowed to use model: ${modelId}`);
      this.name = "ApiKeyModelAccessDeniedError";
    }
  }
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
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    ApiKeyModelAccessDeniedError,
    ApiKeySpendLedgerUnavailableError,
    ApiKeySpendLimitExceededError,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
    assertApiKeyModelAllowed: vi.fn(
      (modelId: string, access: { allowAllModels: boolean; allowedModelIds: string[] }) => {
        if (!access.allowAllModels && !access.allowedModelIds.includes(modelId)) {
          throw new ApiKeyModelAccessDeniedError(modelId);
        }
      },
    ),
  };
});

import { Hono } from "hono";
import { UpstreamAnthropicMessagesApiError } from "../../../src/providers/anthropic";
import { messagesRouter } from "../../../src/modules/messages/router";

describe("messages router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockModelAccess.allowAllModels = true;
    mockModelAccess.includeFutureModels = true;
    mockModelAccess.allowedModelIds = [];
    mockResolveAnthropicMessagesAccessModelId.mockImplementation((model: string) =>
      model.includes(":") ? model : `anthropic:${model}`,
    );
    mockResolveAnthropicMessageTokenCountAccessModelId.mockImplementation((model: string) =>
      model.includes(":") ? model : `anthropic:${model}`,
    );
    mockEstimateCost.mockReturnValue(0.01);
    mockLogStreamStart.mockResolvedValue("log-1");
    mockLogStreamFinal.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST /v1/messages 401 missing API key", async () => {
    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/messages 400 invalid json", async () => {
    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "mux_live_test" },
      body: "bad",
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/messages 403 when the API key cannot access the normalized model", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "mux_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "API key is not allowed to use model: anthropic:claude-test",
    });
    expect(mockHandleAnthropicMessage).not.toHaveBeenCalled();
  });

  it("POST /v1/messages accepts x-api-key and forwards Anthropic headers", async () => {
    mockHandleAnthropicMessage.mockResolvedValueOnce({
      kind: "complete",
      response: {
        id: "msg-1",
        model: "claude-test",
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    });

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "mux_live_test",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "tools-2024-04-04",
      },
      body: JSON.stringify({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "msg-1", model: "claude-test" });
    expect(mockHandleAnthropicMessage).toHaveBeenCalledWith(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      },
      "key-1",
      {
        requireBillableUsage: false,
        providerOptions: {
          headers: {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
          },
        },
        rawBody: expect.any(String),
        requestContext: expect.objectContaining({
          requestPath: "/v1/messages",
        }),
      },
    );
  });

  it("POST /v1/messages/count_tokens forwards Anthropic headers and returns token count", async () => {
    mockHandleAnthropicMessageTokenCount.mockResolvedValueOnce({
      provider: "anthropic",
      model: "anthropic:claude-test",
      response: { input_tokens: 42 },
    });

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "x-api-key": "mux_live_test",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "tools-2024-04-04",
      },
      body: JSON.stringify({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ input_tokens: 42 });
    expect(mockHandleAnthropicMessageTokenCount).toHaveBeenCalledWith(
      {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      },
      "key-1",
      {
        providerOptions: {
          headers: {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
          },
        },
        rawBody: expect.any(String),
        requestContext: expect.objectContaining({
          requestPath: "/v1/messages/count_tokens",
        }),
      },
    );
  });

  it("POST /v1/messages/count_tokens 403 when the API key cannot access the normalized model", async () => {
    mockModelAccess.allowAllModels = false;
    mockModelAccess.includeFutureModels = false;
    mockModelAccess.allowedModelIds = ["openai:gpt-4o"];

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages/count_tokens", {
      method: "POST",
      headers: { "x-api-key": "mux_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "API key is not allowed to use model: anthropic:claude-test",
    });
    expect(mockHandleAnthropicMessageTokenCount).not.toHaveBeenCalled();
  });

  it("POST /v1/messages streams raw Anthropic SSE and logs usage", async () => {
    mockSpendLimit.value = 10;
    async function* rawStream() {
      yield 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":0}}}\n\n';
      yield 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n';
    }
    mockHandleAnthropicMessage.mockResolvedValueOnce({
      kind: "stream",
      stream: rawStream(),
      provider: "anthropic",
      model: "anthropic:claude-test",
      channelId: "anthropic-primary",
      channelName: "Anthropic primary",
      startTime: Date.now(),
    });
    mockEstimateCost.mockReturnValueOnce(0.02);

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { Authorization: "Bearer mux_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic:claude-test",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain("event: message_delta");
    expect(mockHandleAnthropicMessage).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      "key-1",
      expect.objectContaining({ requireBillableUsage: false }),
    );
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.02);
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 9,
        estimatedCost: 0.02,
        channelId: "anthropic-primary",
        channelName: "Anthropic primary",
        statusCode: 200,
      }),
    );
  });

  it("POST /v1/messages preserves upstream Anthropic error bodies", async () => {
    mockHandleAnthropicMessage.mockRejectedValueOnce(
      new UpstreamAnthropicMessagesApiError(
        400,
        '{"type":"error","error":{"message":"bad"}}',
        "application/json",
      ),
    );

    const app = new Hono().route("/v1/messages", messagesRouter);
    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "mux_live_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toBe('{"type":"error","error":{"message":"bad"}}');
  });
});
