import { describe, expect, it } from "vitest";
import { readEmbeddingsRelayConfig } from "../../../src/modules/embeddings/relay/config";
import {
  EmbeddingsRelayClientAbortError,
  EmbeddingsRelayProtocolError,
  retryableEmbeddingsError,
} from "../../../src/modules/embeddings/relay/errors";
import { estimateEmbeddingInputTokens } from "../../../src/modules/embeddings/relay/token-estimator";
import { UpstreamOpenAICompatibleError } from "../../../src/providers/openai-compatible-error";

describe("Embeddings relay primitives", () => {
  it("uses independent relay defaults", () => {
    expect(readEmbeddingsRelayConfig({})).toMatchObject({
      retryCount: 2,
      nonStreamTimeoutMs: 120_000,
      maxRequestBodyBytes: 128 * 1024 * 1024,
      rateLimitWindowSeconds: 60,
      rateLimitTotal: 0,
      rateLimitSuccess: 0,
    });
  });

  it("reads endpoint-specific overrides and rejects invalid settings", () => {
    const config = readEmbeddingsRelayConfig({
      EMBEDDINGS_RETRY_COUNT: "4",
      EMBEDDINGS_RETRY_STATUS_CODES: "425,500-503",
      EMBEDDINGS_NON_STREAM_TIMEOUT_MS: "900",
      EMBEDDINGS_MAX_REQUEST_BODY_MB: "2",
      EMBEDDINGS_RATE_LIMIT_WINDOW_SECONDS: "30",
      EMBEDDINGS_RATE_LIMIT_TOTAL: "10",
      EMBEDDINGS_RATE_LIMIT_SUCCESS: "8",
    });
    expect(config).toMatchObject({
      retryCount: 4,
      retryStatusCodes: [
        { start: 425, end: 425 },
        { start: 500, end: 503 },
      ],
      nonStreamTimeoutMs: 900,
      maxRequestBodyBytes: 2 * 1024 * 1024,
      rateLimitWindowSeconds: 30,
      rateLimitTotal: 10,
      rateLimitSuccess: 8,
    });
    expect(() => readEmbeddingsRelayConfig({ EMBEDDINGS_RETRY_COUNT: "-1" })).toThrow(
      "EMBEDDINGS_RETRY_COUNT",
    );
  });

  it("retries configured upstream statuses and protocol failures only", () => {
    const config = readEmbeddingsRelayConfig({});
    expect(
      retryableEmbeddingsError(
        new UpstreamOpenAICompatibleError({ provider: "fixture", status: 503, body: "{}" }),
        config,
      ),
    ).toBe(true);
    expect(
      retryableEmbeddingsError(
        new UpstreamOpenAICompatibleError({ provider: "fixture", status: 400, body: "{}" }),
        config,
      ),
    ).toBe(false);
    expect(retryableEmbeddingsError(new EmbeddingsRelayProtocolError("bad response"), config)).toBe(
      true,
    );
    expect(retryableEmbeddingsError(new EmbeddingsRelayClientAbortError(), config)).toBe(false);
  });

  it("estimates string inputs and counts supplied token IDs exactly", () => {
    expect(estimateEmbeddingInputTokens("hello")).toBeGreaterThan(0);
    expect(estimateEmbeddingInputTokens(["hello", "world"])).toBeGreaterThan(
      estimateEmbeddingInputTokens("hello"),
    );
    expect(estimateEmbeddingInputTokens([1, 2, 3, 4])).toBe(4);
    expect(
      estimateEmbeddingInputTokens([
        [1, 2],
        [3, 4, 5],
      ]),
    ).toBe(5);
  });
});
