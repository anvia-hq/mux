import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const {
  MockApiKeyModelAccessDeniedError,
  mockAssertApiKeyModelAllowed,
  mockCompletionModel,
  mockCreateCompletionStream,
  mockCreateEventStream,
  mockCreatePlaygroundApiKeyToken,
  mockGetActiveApiKeyForAuth,
  mockOpenAIClient,
  mockRequireRole,
} = vi.hoisted(() => {
  class ApiKeyModelAccessDeniedError extends Error {
    constructor(modelId: string) {
      super(`API key is not allowed to use model: ${modelId}`);
      this.name = "ApiKeyModelAccessDeniedError";
    }
  }

  const completionModel = vi.fn().mockReturnValue({ provider: "openai-chat" });
  return {
    MockApiKeyModelAccessDeniedError: ApiKeyModelAccessDeniedError,
    mockAssertApiKeyModelAllowed: vi.fn(),
    mockCompletionModel: completionModel,
    mockCreateCompletionStream: vi.fn(),
    mockCreateEventStream: vi.fn(),
    mockCreatePlaygroundApiKeyToken: vi.fn(),
    mockGetActiveApiKeyForAuth: vi.fn(),
    mockOpenAIClient: vi.fn().mockImplementation(function (this: { completionModel: unknown }) {
      this.completionModel = completionModel;
    }),
    mockRequireRole: vi.fn(),
  };
});

vi.mock("@anvia/core", () => ({ createCompletionStream: mockCreateCompletionStream }));
vi.mock("@anvia/openai", () => ({ OpenAIClient: mockOpenAIClient }));
vi.mock("@anvia/server", () => ({ createEventStream: mockCreateEventStream }));
vi.mock("../../../src/middleware/api-key", () => ({
  createPlaygroundApiKeyToken: mockCreatePlaygroundApiKeyToken,
}));
vi.mock("../../../src/modules/auth/services", () => ({ requireRole: mockRequireRole }));
vi.mock("../../../src/modules/keys/services", () => ({
  ApiKeyModelAccessDeniedError: MockApiKeyModelAccessDeniedError,
  assertApiKeyModelAllowed: mockAssertApiKeyModelAllowed,
  getActiveApiKeyForAuth: mockGetActiveApiKeyForAuth,
}));

import { playgroundRouter } from "../../../src/modules/playground/router";
import { ApiKeyModelAccessDeniedError } from "../../../src/modules/keys/services";

function createApp() {
  return new Hono().route("/playground", playgroundRouter);
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    apiKeyId: "key-1",
    model: "e2e:e2e-chat",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    stream: true,
    ...overrides,
  };
}

describe("playground router", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.PLAYGROUND_OPENAI_BASE_URL;
    delete process.env.API_PORT;
  });

  it("requires admin access", async () => {
    mockRequireRole.mockResolvedValueOnce(null);

    const res = await createApp().request("/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody()),
    });

    expect(res.status).toBe(403);
    expect(mockGetActiveApiKeyForAuth).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or revoked keys", async () => {
    mockRequireRole.mockResolvedValueOnce({ id: "admin-1" });
    mockGetActiveApiKeyForAuth.mockResolvedValueOnce(null);

    const res = await createApp().request("/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody()),
    });

    expect(res.status).toBe(404);
  });

  it("rejects spend-limited keys", async () => {
    mockRequireRole.mockResolvedValueOnce({ id: "admin-1" });
    mockGetActiveApiKeyForAuth.mockResolvedValueOnce({
      id: "key-1",
      spendLimitUsd: 10,
    });

    const res = await createApp().request("/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody()),
    });

    expect(res.status).toBe(422);
    expect(mockCreatePlaygroundApiKeyToken).not.toHaveBeenCalled();
  });

  it("rejects models outside the selected key access", async () => {
    mockRequireRole.mockResolvedValueOnce({ id: "admin-1" });
    mockGetActiveApiKeyForAuth.mockResolvedValueOnce({
      id: "key-1",
      spendLimitUsd: null,
      allowAllModels: false,
      allowedModelIds: ["openai:gpt-4o"],
    });
    mockAssertApiKeyModelAllowed.mockImplementationOnce(() => {
      throw new ApiKeyModelAccessDeniedError("e2e:e2e-chat");
    });

    const res = await createApp().request("/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody()),
    });

    expect(res.status).toBe(403);
    expect(mockCreatePlaygroundApiKeyToken).not.toHaveBeenCalled();
  });

  it("streams a completion through the OpenAI-compatible gateway", async () => {
    process.env.API_PORT = "8010";
    mockRequireRole.mockResolvedValueOnce({ id: "admin-1" });
    mockGetActiveApiKeyForAuth.mockResolvedValueOnce({
      id: "key-1",
      spendLimitUsd: null,
      allowAllModels: true,
      allowedModelIds: [],
    });
    mockCreatePlaygroundApiKeyToken.mockResolvedValueOnce("mux_playground_token");
    mockCreateCompletionStream.mockReturnValueOnce(
      (async function* stream() {
        yield { type: "text_delta", delta: "hello" };
      })(),
    );
    mockCreateEventStream.mockReturnValueOnce(new Response("jsonl", { status: 200 }));

    const res = await createApp().request("/playground/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody()),
    });

    expect(res.status).toBe(200);
    expect(mockOpenAIClient).toHaveBeenCalledWith({
      apiKey: "mux_playground_token",
      baseUrl: "http://127.0.0.1:8010/v1",
      completionApi: "chat",
    });
    expect(mockCompletionModel).toHaveBeenCalledWith("e2e:e2e-chat");
    expect(mockCreateCompletionStream).toHaveBeenCalledWith(
      { provider: "openai-chat" },
      { messages: requestBody().messages },
    );
    expect(mockCreateEventStream).toHaveBeenCalledWith(expect.anything(), { format: "jsonl" });
  });
});
