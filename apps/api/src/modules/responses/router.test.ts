import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockAddApiKeySpendUsd,
  mockAssertApiKeyCanSpend,
  mockEstimateCost,
  mockHandleResponseCreate,
  mockHandleResponseCreateStream,
  mockHandleResponseRetrieve,
  mockLogStreamFinal,
  mockLogStreamStart,
  mockSpendLimit,
} = vi.hoisted(() => ({
  mockAddApiKeySpendUsd: vi.fn(),
  mockAssertApiKeyCanSpend: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockHandleResponseCreate: vi.fn(),
  mockHandleResponseCreateStream: vi.fn(),
  mockHandleResponseRetrieve: vi.fn(),
  mockLogStreamFinal: vi.fn(),
  mockLogStreamStart: vi.fn(),
  mockSpendLimit: { value: null as number | null },
}));

vi.mock("./services", () => {
  class UnsupportedResponseFeatureError extends Error {
    constructor(message = "Responses API is not supported") {
      super(message);
      this.name = "UnsupportedResponseFeatureError";
    }
  }

  class ApiKeyUnbillableResponseUsageError extends Error {
    constructor() {
      super(
        "API key spend limit requires billable usage, but this response request cost could not be determined",
      );
      this.name = "ApiKeyUnbillableResponseUsageError";
    }
  }

  class OpenAIResponseProviderNotConfiguredError extends Error {
    constructor() {
      super("OpenAI provider is not configured");
      this.name = "OpenAIResponseProviderNotConfiguredError";
    }
  }

  return {
    ApiKeyUnbillableResponseUsageError,
    OpenAIResponseProviderNotConfiguredError,
    UnsupportedResponseFeatureError,
    handleResponseCreate: mockHandleResponseCreate,
    handleResponseCreateStream: mockHandleResponseCreateStream,
    handleResponseRetrieve: mockHandleResponseRetrieve,
    validateResponseCreateRequestShape: vi.fn((body: { model?: string }) =>
      typeof body.model === "string" && body.model.length > 0
        ? null
        : "request must include a model",
    ),
  };
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

vi.mock("../../middleware/logger", () => {
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

vi.mock("../../providers/registry", () => ({ estimateCost: mockEstimateCost }));

vi.mock("../keys/services", () => {
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
    addApiKeySpendUsd: mockAddApiKeySpendUsd,
    assertApiKeyCanSpend: mockAssertApiKeyCanSpend,
  };
});

import { Hono } from "hono";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import { ApiKeySpendLedgerUnavailableError, ApiKeySpendLimitExceededError } from "../keys/services";
import {
  ApiKeyUnbillableResponseUsageError,
  OpenAIResponseProviderNotConfiguredError,
  UnsupportedResponseFeatureError,
} from "./services";
import { responsesRouter } from "./router";

describe("responses router", () => {
  beforeEach(() => {
    mockSpendLimit.value = null;
    mockEstimateCost.mockReturnValue(0.01);
    mockLogStreamFinal.mockResolvedValue(undefined);
    mockLogStreamStart.mockResolvedValue("log-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POST /v1/responses 400 invalid json", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", { method: "POST", body: "bad" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses 400 missing model", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/responses 200 success", async () => {
    mockHandleResponseCreate.mockResolvedValueOnce({
      id: "resp-1",
      model: "openai:gpt-4o",
      output: [],
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ id: "resp-1" });
    expect(mockHandleResponseCreate).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: false,
    });
  });

  it("POST /v1/responses 422 for unsupported background mode before spend checks", async () => {
    mockSpendLimit.value = 10;
    const app = new Hono().route("/v1/responses", responsesRouter);

    const background = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", background: true }),
    });
    expect(background.status).toBe(422);
    expect(mockAssertApiKeyCanSpend).not.toHaveBeenCalled();
    expect(mockHandleResponseCreate).not.toHaveBeenCalled();
  });

  it("POST /v1/responses streams raw SSE and finalizes usage logs", async () => {
    async function* chunks() {
      yield 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n';
      yield 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n';
    }

    mockHandleResponseCreateStream.mockResolvedValueOnce({
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-4o",
      startTime: Date.now(),
    });

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(res.text()).resolves.toBe(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n',
    );
    expect(mockLogStreamStart).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/v1/responses", statusCode: 102 }),
    );
    expect(mockLogStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        promptTokens: 2,
        completionTokens: 3,
        totalTokens: 5,
        estimatedCost: 0.01,
        statusCode: 200,
      }),
    );
  });

  it("POST /v1/responses allows limited streaming and charges after final usage", async () => {
    mockSpendLimit.value = 10;

    async function* chunks() {
      yield 'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n';
    }

    mockHandleResponseCreateStream.mockResolvedValueOnce({
      stream: chunks(),
      provider: "openai",
      model: "openai:gpt-4o",
      startTime: Date.now(),
    });

    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi", stream: true }),
    });

    expect(res.status).toBe(200);
    await res.text();
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockAddApiKeySpendUsd).toHaveBeenCalledWith("key-1", 0.01);
  });

  it("POST /v1/responses checks spend limit before limited request", async () => {
    mockSpendLimit.value = 10;
    mockHandleResponseCreate.mockResolvedValueOnce({
      id: "resp-1",
      model: "openai:gpt-4o",
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });

    expect(res.status).toBe(200);
    expect(mockAssertApiKeyCanSpend).toHaveBeenCalledWith("key-1", 10);
    expect(mockHandleResponseCreate).toHaveBeenCalledWith(expect.anything(), "key-1", {
      requireBillableUsage: true,
    });
  });

  it("POST /v1/responses maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);
    const body = JSON.stringify({ model: "openai:gpt-4o", input: "hi" });

    mockHandleResponseCreate.mockRejectedValueOnce(new Error("No provider found for model: x"));
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 404);

    mockHandleResponseCreate.mockRejectedValueOnce(
      new UnsupportedResponseFeatureError("Responses streaming is not supported yet"),
    );
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 422);

    mockHandleResponseCreate.mockRejectedValueOnce(new ApiKeyUnbillableResponseUsageError());
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 429);

    mockHandleResponseCreate.mockRejectedValueOnce(new RequestLoggingUnavailableError(new Error()));
    expect(
      await app.request("/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ).toHaveProperty("status", 503);
  });

  it("POST /v1/responses maps spend limit errors", async () => {
    mockSpendLimit.value = 10;
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(new ApiKeySpendLimitExceededError());
    const exhausted = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });
    expect(exhausted.status).toBe(429);

    mockAssertApiKeyCanSpend.mockRejectedValueOnce(
      new ApiKeySpendLedgerUnavailableError(new Error()),
    );
    const unavailable = await app.request("/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai:gpt-4o", input: "hi" }),
    });
    expect(unavailable.status).toBe(503);
  });

  it("GET /v1/responses/:id returns 200 with the response body", async () => {
    mockHandleResponseRetrieve.mockResolvedValueOnce({
      id: "resp_abc",
      object: "response",
      status: "completed",
      model: "gpt-4o-2024-08-06",
    });
    const app = new Hono().route("/v1/responses", responsesRouter);
    const res = await app.request("/v1/responses/resp_abc", { method: "GET" });

    expect(res.status).toBe(200);
    expect(mockHandleResponseRetrieve).toHaveBeenCalledWith("resp_abc", "key-1");
    await expect(res.json()).resolves.toMatchObject({ id: "resp_abc" });
  });

  it("GET /v1/responses/:id maps known service errors", async () => {
    const app = new Hono().route("/v1/responses", responsesRouter);

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new OpenAIResponseProviderNotConfiguredError(),
    );
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(new UnsupportedResponseFeatureError("nope"));
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      422,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new RequestLoggingUnavailableError(new Error()),
    );
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      503,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(
      new Error("OpenAI Responses API error: 404 - not found"),
    );
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      404,
    );

    mockHandleResponseRetrieve.mockRejectedValueOnce(new Error("boom"));
    expect(await app.request("/v1/responses/resp_abc", { method: "GET" })).toHaveProperty(
      "status",
      500,
    );
  });
});
