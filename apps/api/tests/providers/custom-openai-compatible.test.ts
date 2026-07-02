import { afterEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

import { CustomOpenAICompatibleAdapter } from "../../src/providers/custom-openai-compatible";
import type { Model } from "../../src/providers/types";

const models: Model[] = [
  {
    id: "embed",
    name: "Embed",
    provider: "custom",
    inputPricePer1M: 1,
    outputPricePer1M: 0,
    contextWindow: 8192,
    maxOutputTokens: 1536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
];

describe("CustomOpenAICompatibleAdapter", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("advertises embeddings without enabling Responses", () => {
    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1",
      models,
    });

    expect(adapter.capabilities.embeddingsApi).toBe(true);
    expect(adapter.capabilities.responsesApi).toBe(false);
  });

  it("creates embeddings through the derived OpenAI-compatible endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        object: "list",
        data: [{ object: "embedding", embedding: "base64-data", index: 0 }],
        model: "embed",
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
    );

    const adapter = new CustomOpenAICompatibleAdapter({
      name: "custom",
      apiKey: "k",
      apiBase: "https://custom.example/v1/chat/completions",
      models,
    });
    const response = await adapter.createEmbedding({
      model: "embed",
      input: "hello",
      encoding_format: "base64",
    });

    expect(response.data[0]?.embedding).toBe("base64-data");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.example/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer k",
        },
      }),
    );
  });
});
