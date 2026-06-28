import { describe, expect, it, vi } from "vitest";
import {
  buildBenchmarkChatRequest,
  cleanupBenchmarkState,
  compareSamples,
  ensureOpenAIProvider,
  formatResultsTable,
  parseArgs,
  percentile,
  runSamples,
  summarizeLatencies,
  unquoteEnvValue,
} from "../../../scripts/benchmark-overhead";

describe("overhead benchmark helpers", () => {
  const env = {
    OPENAI_API_KEY: "sk-test",
    MUX_ADMIN_EMAIL: "admin@example.com",
    MUX_ADMIN_PASSWORD: "password123",
  };

  it("parses defaults and Caddy API URLs", () => {
    const config = parseArgs([], env);

    expect(config).toMatchObject({
      model: "gpt-5.4-mini",
      muxModel: "openai:gpt-5.4-mini",
      requests: 30,
      warmup: 5,
      streamRequests: 20,
      concurrency: 1,
      muxBaseUrl: "http://localhost",
      muxApiBaseUrl: "http://localhost/api",
      muxApiKey: undefined,
    });
  });

  it("accepts an existing Mux API key", () => {
    const config = parseArgs([], { ...env, MUX_API_KEY: "mux_live_test" });

    expect(config.muxApiKey).toBe("mux_live_test");
  });

  it("parses explicit benchmark options", () => {
    const config = parseArgs(
      [
        "--model",
        "gpt-5",
        "--requests=10",
        "--warmup",
        "0",
        "--stream-requests",
        "4",
        "--concurrency",
        "2",
        "--mux-base-url",
        "http://localhost/",
        "--output",
        "tmp/result.json",
      ],
      env,
    );

    expect(config).toMatchObject({
      model: "gpt-5",
      muxModel: "openai:gpt-5",
      requests: 10,
      warmup: 0,
      streamRequests: 4,
      concurrency: 2,
      muxBaseUrl: "http://localhost",
      muxApiBaseUrl: "http://localhost/api",
      output: "tmp/result.json",
    });
  });

  it("unquotes dotenv values", () => {
    expect(unquoteEnvValue('"sk-test"')).toBe("sk-test");
    expect(unquoteEnvValue("'admin@example.com'")).toBe("admin@example.com");
    expect(unquoteEnvValue("http://localhost")).toBe("http://localhost");
  });

  it("builds benchmark requests without sampling overrides", () => {
    expect(buildBenchmarkChatRequest({ model: "gpt-5.4-mini" })).toMatchObject({
      model: "gpt-5.4-mini",
      max_completion_tokens: 32,
    });
    expect(buildBenchmarkChatRequest({ model: "gpt-5.4-mini" })).not.toHaveProperty("temperature");
    expect(buildBenchmarkChatRequest({ model: "gpt-5.4-mini" })).not.toHaveProperty("max_tokens");

    expect(buildBenchmarkChatRequest({ model: "gpt-5.4-mini", stream: true })).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 64,
    });
  });

  it("computes percentile and latency summaries", () => {
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);

    expect(summarizeLatencies([10, 20, 30], 2)).toEqual({
      count: 3,
      failures: 2,
      minMs: 10,
      p50Ms: 20,
      p95Ms: 30,
      maxMs: 30,
      avgMs: 20,
    });
  });

  it("computes overhead from direct and mux samples", () => {
    const comparison = compareSamples(
      { samples: [{ latencyMs: 100 }, { latencyMs: 120 }], failures: [] },
      { samples: [{ latencyMs: 130 }, { latencyMs: 150 }], failures: [] },
      "latencyMs",
    );

    expect(comparison.overheadMs).toBe(30);
    expect(comparison.overheadPercent).toBe(30);
  });

  it("logs sample progress", async () => {
    const logs: string[] = [];
    const result = await runSamples(
      "Test phase",
      3,
      1,
      (message) => logs.push(message),
      async () => ({
        latencyMs: 10,
      }),
    );

    expect(result.samples).toHaveLength(3);
    expect(logs).toContain("Starting Test phase: 3 request(s), concurrency 1.");
    expect(logs).toContain("Test phase: 3/3 complete (0 failed).");
    expect(logs).toContain("Test phase finished: 3 succeeded, 0 failed.");
  });

  it("does not configure OpenAI when already present", async () => {
    const client = {
      getProviders: vi.fn().mockResolvedValue([{ provider: "openai" }]),
      setOpenAIProvider: vi.fn(),
    };

    await expect(ensureOpenAIProvider(client, "sk-test")).resolves.toBe(false);
    expect(client.setOpenAIProvider).not.toHaveBeenCalled();
  });

  it("configures OpenAI when absent", async () => {
    const client = {
      getProviders: vi.fn().mockResolvedValue([]),
      setOpenAIProvider: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureOpenAIProvider(client, "sk-test")).resolves.toBe(true);
    expect(client.setOpenAIProvider).toHaveBeenCalledWith("sk-test");
  });

  it("cleans up temporary API key and temporary provider", async () => {
    const client = {
      revokeApiKey: vi.fn().mockResolvedValue(undefined),
      deleteOpenAIProvider: vi.fn().mockResolvedValue(undefined),
    };

    await cleanupBenchmarkState(client, {
      muxApiKeyId: "key-1",
      configuredOpenAIProvider: true,
    });

    expect(client.revokeApiKey).toHaveBeenCalledWith("key-1");
    expect(client.deleteOpenAIProvider).toHaveBeenCalled();
  });

  it("formats a terminal table", () => {
    const table = formatResultsTable({
      metadata: {
        timestamp: "2026-06-21T00:00:00.000Z",
        nodeVersion: "v22.0.0",
        model: "gpt-5.4-mini",
        muxModel: "openai:gpt-5.4-mini",
        muxBaseUrl: "http://localhost",
        directChatCompletionsUrl: "https://api.openai.com/v1/chat/completions",
        requests: 1,
        streamRequests: 1,
        warmup: 0,
        concurrency: 1,
      },
      setup: {
        temporaryMuxApiKeyId: "key-1",
        usedExistingMuxApiKey: false,
        configuredOpenAIProvider: false,
      },
      nonStreaming: {
        direct: summarizeLatencies([100]),
        mux: summarizeLatencies([120]),
        overheadMs: 20,
        overheadPercent: 20,
      },
      streaming: {
        firstChunk: {
          direct: summarizeLatencies([80]),
          mux: summarizeLatencies([90]),
          overheadMs: 10,
          overheadPercent: 12.5,
        },
        total: {
          direct: summarizeLatencies([200]),
          mux: summarizeLatencies([230]),
          overheadMs: 30,
          overheadPercent: 15,
        },
      },
    });

    expect(table).toContain("Non-stream total");
    expect(table).toContain("Stream first chunk");
    expect(table).toContain("20.00%");
  });
});
