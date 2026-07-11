import { beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, processBackgroundPollJob } from "../src/background-response-worker";
import { ProviderKeyUnavailableError } from "../src/provider-keys";
import type { BackgroundPollJob } from "../src/background-response-queue";
import type { RequestLogJob } from "../src/request-log-queue";

const {
  mockEnqueue,
  mockEnqueueLog,
  mockGetProviderApiKey,
  mockGetProviderHeaders,
  mockIncrbyfloat,
  mockRedisMulti,
  mockRedisTransaction,
  mockPrismaApiKeyFindUnique,
  mockPrismaFindUnique,
  mockPrismaUpdate,
} = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnqueueLog: vi.fn(),
  mockGetProviderApiKey: vi.fn(),
  mockGetProviderHeaders: vi.fn(),
  mockIncrbyfloat: vi.fn(),
  mockRedisMulti: vi.fn(),
  mockRedisTransaction: {
    incrbyfloat: vi.fn(),
    exec: vi.fn(),
  },
  mockPrismaApiKeyFindUnique: vi.fn(),
  mockPrismaFindUnique: vi.fn(),
  mockPrismaUpdate: vi.fn(),
}));

vi.mock("../src/prisma", () => ({
  prisma: {
    backgroundResponseJob: {
      findUnique: mockPrismaFindUnique,
      update: mockPrismaUpdate,
    },
    apiKey: {
      findUnique: mockPrismaApiKeyFindUnique,
    },
  },
}));

function makeJob(overrides: Partial<BackgroundPollJob> = {}): BackgroundPollJob {
  return { jobId: "resp_bg_abc", attempt: 1, ...overrides };
}

function makeRow(
  overrides: Partial<{
    id: string;
    apiKeyId: string;
    provider: string;
    model: string;
    request: unknown;
    status: string;
    response: unknown;
    inputPricePer1M: number | null;
    outputPricePer1M: number | null;
    pricingTiers: unknown;
    channelId: string | null;
    channelName: string | null;
  }> = {},
) {
  return {
    id: "resp_bg_abc",
    apiKeyId: "key-1",
    provider: "openai",
    model: "openai:gpt-5",
    request: { model: "fast-chat" },
    status: "queued",
    response: null,
    channelId: null,
    channelName: null,
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    ...overrides,
  };
}

function fakeFetchResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildDeps(
  fetchImpl: typeof fetch,
  overrides: Partial<{
    now: () => Date;
    getProviderApiKey: (provider: string) => Promise<string>;
    getProviderHeaders: (
      provider: string,
      channelId: string | null | undefined,
      apiKey: string,
    ) => Promise<Record<string, string>>;
  }> = {},
) {
  mockRedisTransaction.incrbyfloat.mockReturnValue(mockRedisTransaction);
  mockRedisMulti.mockReturnValue(mockRedisTransaction);

  return {
    fetch: fetchImpl,
    redis: { incrbyfloat: mockIncrbyfloat, multi: mockRedisMulti } as never,
    now: overrides.now ?? (() => new Date("2026-06-24T00:00:00Z")),
    enqueue: mockEnqueue,
    enqueueLog: mockEnqueueLog,
    getProviderApiKey: overrides.getProviderApiKey ?? mockGetProviderApiKey,
    getProviderHeaders: overrides.getProviderHeaders ?? mockGetProviderHeaders,
    prismaClient: {
      backgroundResponseJob: {
        findUnique: mockPrismaFindUnique,
        update: mockPrismaUpdate,
      },
      apiKey: {
        findUnique: mockPrismaApiKeyFindUnique,
      },
    } as never,
  };
}

describe("backoffMs", () => {
  it("returns 2s on attempt 1", () => {
    expect(backoffMs(1)).toBe(2_000);
  });

  it("returns 4s on attempt 2", () => {
    expect(backoffMs(2)).toBe(4_000);
  });

  it("returns 8s on attempt 3", () => {
    expect(backoffMs(3)).toBe(8_000);
  });

  it("returns 16s on attempt 4", () => {
    expect(backoffMs(4)).toBe(16_000);
  });

  it("caps at 30s for attempt 5+", () => {
    expect(backoffMs(5)).toBe(30_000);
    expect(backoffMs(10)).toBe(30_000);
  });

  it("treats 0 or negative attempts as 1", () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(-3)).toBe(2_000);
  });
});

describe("processBackgroundPollJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue("sk-test");
    mockGetProviderHeaders.mockResolvedValue({});
  });

  it("is a no-op when the row is missing", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(null);
    await processBackgroundPollJob(
      makeJob(),
      buildDeps(async () => fakeFetchResponse({})),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when the row is already terminal", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "completed" }));
    await processBackgroundPollJob(
      makeJob(),
      buildDeps(async () => fakeFetchResponse({})),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
  });

  it("updates the row and re-enqueues when upstream is queued", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "queued" }));
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({ id: "resp_bg_abc", status: "queued", model: "gpt-5" }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});
    await processBackgroundPollJob(
      makeJob({ attempt: 1 }),
      buildDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v1/responses/resp_bg_abc"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resp_bg_abc" },
        data: expect.objectContaining({ status: "queued" }),
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith("resp_bg_abc", 2, 4_000);
  });

  it("applies static channel headers while polling upstream", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(
      makeRow({ status: "queued", channelId: "openai-primary" }),
    );
    mockGetProviderHeaders.mockResolvedValueOnce({
      "x-project": "proj_123",
    });
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({ id: "resp_bg_abc", status: "queued", model: "gpt-5" }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});

    await processBackgroundPollJob(
      makeJob({ attempt: 1 }),
      buildDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(mockGetProviderHeaders).toHaveBeenCalledWith("openai", "openai-primary", "sk-test");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v1/responses/resp_bg_abc"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "x-project": "proj_123",
        }),
      }),
    );
  });

  it("writes the response, bills the API key, and enqueues a final log on completion", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "in_progress" }));
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({
        id: "resp_bg_abc",
        status: "completed",
        model: "gpt-5",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
          output_tokens_details: { reasoning_tokens: 12 },
        },
      }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});
    mockPrismaApiKeyFindUnique.mockResolvedValueOnce({ createdBy: "user-1" });
    mockRedisTransaction.exec.mockResolvedValueOnce([
      [null, "0.002125"],
      [null, "0.002125"],
    ]);
    await processBackgroundPollJob(
      makeJob({ attempt: 3 }),
      buildDeps(fetchImpl as unknown as typeof fetch),
    );

    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resp_bg_abc" },
        data: expect.objectContaining({
          status: "completed",
          completedAt: new Date("2026-06-24T00:00:00Z"),
        }),
      }),
    );
    // 100 * 1.25 / 1e6 + 200 * 10 / 1e6 = 0.000125 + 0.002 = 0.002125
    expect(mockRedisTransaction.incrbyfloat).toHaveBeenCalledWith("apikey_spend:key-1", 0.002125);
    expect(mockRedisTransaction.incrbyfloat).toHaveBeenCalledWith("user_spend:user-1", 0.002125);
    expect(mockEnqueueLog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "final",
        apiKeyId: "key-1",
        provider: "openai",
        model: "openai:gpt-5",
        requestedModel: "fast-chat",
        endpoint: "/v1/responses",
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        estimatedCost: 0.002125,
        pricingInputTokens: 100,
        appliedInputPricePer1M: 1.25,
        appliedOutputPricePer1M: 10,
        reasoningTokens: 12,
        statusCode: 200,
      }) satisfies Partial<RequestLogJob>,
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("uses the snapshotted whole-request tier after its threshold is crossed", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(
      makeRow({
        pricingTiers: [
          { inputTokenThreshold: 200_000, inputPricePer1M: 2.5, outputPricePer1M: 15 },
        ],
      }),
    );
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({
        id: "resp_bg_abc",
        status: "completed",
        usage: { input_tokens: 250_000, output_tokens: 100, total_tokens: 250_100 },
      }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});
    mockPrismaApiKeyFindUnique.mockResolvedValueOnce({ createdBy: "user-1" });
    mockRedisTransaction.exec.mockResolvedValueOnce([
      [null, "0.6265"],
      [null, "0.6265"],
    ]);

    await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));

    expect(mockRedisTransaction.incrbyfloat).toHaveBeenCalledWith("apikey_spend:key-1", 0.6265);
    expect(mockEnqueueLog).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedCost: 0.6265,
        pricingInputTokens: 250_000,
        appliedInputPricePer1M: 2.5,
        appliedOutputPricePer1M: 15,
        appliedPricingTierThreshold: 200_000,
      }) satisfies Partial<RequestLogJob>,
    );
  });

  it("marks the row failed when the upstream returns 404", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "queued" }));
    const fetchImpl = vi.fn(async () => fakeFetchResponse("not found", 404));
    mockPrismaUpdate.mockResolvedValueOnce({});
    await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));

    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("upstream 404"),
        }),
      }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockEnqueueLog).not.toHaveBeenCalled();
  });

  it("rethrows on upstream 5xx so BullMQ can retry with backoff", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "queued" }));
    const fetchImpl = vi.fn(async () => fakeFetchResponse("boom", 500));
    await expect(
      processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch)),
    ).rejects.toThrow(/Background poll upstream error: 500/);
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
  });

  it("does not bill when completed with zero usage", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "queued" }));
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({ id: "resp_bg_abc", status: "completed", model: "gpt-5" }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});
    await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));

    expect(mockIncrbyfloat).not.toHaveBeenCalled();
    expect(mockEnqueueLog).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "final", statusCode: 200 }),
    );
  });

  it("does not bill when completed row has no pricing metadata", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(
      makeRow({ inputPricePer1M: null, outputPricePer1M: null }),
    );
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({
        id: "resp_bg_abc",
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});

    await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));

    expect(mockIncrbyfloat).not.toHaveBeenCalled();
    expect(mockEnqueueLog).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCost: undefined }),
    );
  });

  it("marks the row failed when provider key lookup fails", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ status: "queued" }));
    const fetchImpl = vi.fn(async () => fakeFetchResponse({}));
    mockPrismaUpdate.mockResolvedValueOnce({});

    await processBackgroundPollJob(
      makeJob(),
      buildDeps(fetchImpl as unknown as typeof fetch, {
        getProviderApiKey: async () => {
          throw new ProviderKeyUnavailableError("openai");
        },
      }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("provider key unavailable"),
        }),
      }),
    );
  });

  it("marks Azure rows failed when the Azure endpoint is not configured", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ provider: "azure-cognitive-services" }));
    const fetchImpl = vi.fn(async () => fakeFetchResponse({}));
    mockPrismaUpdate.mockResolvedValueOnce({});
    delete process.env.AZURE_OPENAI_RESPONSES_ENDPOINT;

    await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("AZURE_OPENAI_RESPONSES_ENDPOINT"),
        }),
      }),
    );
  });

  it("uses the Azure endpoint when provider is azure-cognitive-services", async () => {
    mockPrismaFindUnique.mockResolvedValueOnce(makeRow({ provider: "azure-cognitive-services" }));
    const fetchImpl = vi.fn(async () =>
      fakeFetchResponse({ id: "resp_bg_abc", status: "completed" }),
    );
    mockPrismaUpdate.mockResolvedValueOnce({});
    process.env.AZURE_OPENAI_RESPONSES_ENDPOINT = "https://example.openai.azure.com";
    try {
      await processBackgroundPollJob(makeJob(), buildDeps(fetchImpl as unknown as typeof fetch));
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining("https://example.openai.azure.com/openai/v1/responses/resp_bg_abc"),
        expect.any(Object),
      );
    } finally {
      delete process.env.AZURE_OPENAI_RESPONSES_ENDPOINT;
    }
  });
});
