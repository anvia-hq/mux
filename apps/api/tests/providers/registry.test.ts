import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockDecrypt } = vi.hoisted(() => ({
  mockPrisma: {
    providerChannel: { findMany: vi.fn(), findUnique: vi.fn() },
    providerKey: { findMany: vi.fn(), findUnique: vi.fn() },
    customProvider: { findMany: vi.fn(), findUnique: vi.fn() },
    disabledModel: { findMany: vi.fn() },
    fallbackGroup: { findMany: vi.fn(), findUnique: vi.fn() },
    modelAlias: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  mockDecrypt: vi.fn(),
}));

vi.mock("../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../src/modules/providers/crypto", () => ({ decrypt: mockDecrypt }));

import {
  clearProviderCacheForE2e,
  estimateCost,
  initProviders,
  listPublicModels,
  resolveAudioSpeechModel,
  resolveAudioTranscriptionModel,
  resolveChatModel,
  resolveCompletionModel,
  resolveEmbeddingModel,
  resolveImageGenerationModel,
  resolveModerationModel,
  resolveResponseTarget,
} from "../../src/providers/registry";

describe("resolveResponseTarget", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCacheForE2e();
    mockPrisma.providerChannel.findMany.mockRejectedValue(new Error("ProviderChannel missing"));
    mockPrisma.customProvider.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findUnique.mockResolvedValue(null);
  });

  it("returns null for a model id that does not parse as provider:model", async () => {
    mockPrisma.disabledModel.findMany.mockResolvedValue([]);
    expect(await resolveResponseTarget("not-a-model")).toBeNull();
  });

  it("returns null when the provider is not configured", async () => {
    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    expect(await resolveResponseTarget("openai:gpt-4o")).toBeNull();
  });

  it("returns null when the fallback group has no targets", async () => {
    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce(null);
    expect(await resolveResponseTarget("mux:fast")).toBeNull();
    expect(mockPrisma.fallbackGroup.findUnique).toHaveBeenCalledWith({
      where: { id: "fast" },
      include: { targets: { orderBy: { position: "asc" } } },
    });
  });

  it("skips non-Responses-capable targets in a fallback group and returns null when none match", async () => {
    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "anthropic-only",
      name: "Anthropic only",
      description: null,
      enabled: true,
      targets: [{ provider: "anthropic", modelId: "claude", position: 0 }],
    });
    expect(await resolveResponseTarget("mux:anthropic-only")).toBeNull();
  });
});

describe("resolveEmbeddingModel", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCacheForE2e();
    mockPrisma.customProvider.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findUnique.mockResolvedValue(null);
  });

  it("returns only embedding-capable targets from fallback groups", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "openai", ciphertext: "enc-openai" },
      { provider: "anthropic", ciphertext: "enc-anthropic" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([]);
    mockDecrypt.mockReturnValue("key");

    await initProviders();

    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "embed",
      name: "Embed",
      description: null,
      enabled: true,
      targets: [
        { provider: "anthropic", modelId: "claude-3-haiku-20240307", position: 0 },
        { provider: "openai", modelId: "text-embedding-3-small", position: 1 },
      ],
    });

    await expect(resolveEmbeddingModel("mux:embed")).resolves.toMatchObject({
      kind: "fallback-group",
      requestedModelId: "mux:embed",
      targets: [{ providerName: "openai", modelId: "text-embedding-3-small" }],
    });
  });
});

describe("OpenAI-compatible endpoint resolvers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCacheForE2e();
    mockPrisma.customProvider.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findUnique.mockResolvedValue(null);
  });

  it("returns only moderation-capable targets from fallback groups", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "openai", ciphertext: "enc-openai" },
      { provider: "anthropic", ciphertext: "enc-anthropic" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([]);
    mockDecrypt.mockReturnValue("key");

    await initProviders();

    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "moderate",
      name: "Moderate",
      description: null,
      enabled: true,
      targets: [
        { provider: "anthropic", modelId: "claude-3-haiku-20240307", position: 0 },
        { provider: "openai", modelId: "text-moderation-latest", position: 1 },
      ],
    });

    await expect(resolveModerationModel("mux:moderate")).resolves.toMatchObject({
      kind: "fallback-group",
      requestedModelId: "mux:moderate",
      targets: [{ providerName: "openai", modelId: "text-moderation-latest" }],
    });
  });

  it("skips models.dev targets without apiBase for new passthrough endpoints", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "xai", ciphertext: "enc-xai" },
      { provider: "openai", ciphertext: "enc-openai" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([]);
    mockDecrypt.mockReturnValue("key");

    await initProviders();

    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "legacy-completions",
      name: "Legacy completions",
      description: null,
      enabled: true,
      targets: [
        { provider: "xai", modelId: "grok-4.3", position: 0 },
        { provider: "openai", modelId: "gpt-3.5-turbo-instruct", position: 1 },
      ],
    });

    await expect(resolveCompletionModel("mux:legacy-completions")).resolves.toMatchObject({
      kind: "fallback-group",
      requestedModelId: "mux:legacy-completions",
      targets: [{ providerName: "openai", modelId: "gpt-3.5-turbo-instruct" }],
    });
  });

  it("returns only audio-capable targets from fallback groups", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "openai", ciphertext: "enc-openai" },
      { provider: "anthropic", ciphertext: "enc-anthropic" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([]);
    mockDecrypt.mockReturnValue("key");

    await initProviders();

    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "transcribe",
      name: "Transcribe",
      description: null,
      enabled: true,
      targets: [
        { provider: "anthropic", modelId: "claude-3-haiku-20240307", position: 0 },
        { provider: "openai", modelId: "whisper-1", position: 1 },
      ],
    });

    await expect(resolveAudioTranscriptionModel("mux:transcribe")).resolves.toMatchObject({
      kind: "fallback-group",
      requestedModelId: "mux:transcribe",
      targets: [{ providerName: "openai", modelId: "whisper-1" }],
    });

    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValueOnce({
      id: "speech",
      name: "Speech",
      description: null,
      enabled: true,
      targets: [
        { provider: "anthropic", modelId: "claude-3-haiku-20240307", position: 0 },
        { provider: "openai", modelId: "tts-1", position: 1 },
      ],
    });

    await expect(resolveAudioSpeechModel("mux:speech")).resolves.toMatchObject({
      kind: "fallback-group",
      requestedModelId: "mux:speech",
      targets: [{ providerName: "openai", modelId: "tts-1" }],
    });
  });
});

describe("custom providers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCacheForE2e();
    mockPrisma.providerChannel.findMany.mockRejectedValue(new Error("ProviderChannel missing"));
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findUnique.mockResolvedValue(null);
  });

  it("loads custom providers from database metadata", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "custom-openai", ciphertext: "enc" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([
      {
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [
          {
            modelId: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      },
    ]);
    mockDecrypt.mockReturnValueOnce("custom-key");
    mockPrisma.disabledModel.findMany.mockResolvedValue([]);
    mockPrisma.fallbackGroup.findMany.mockResolvedValue([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValue(null);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);

    await initProviders();

    await expect(listPublicModels()).resolves.toEqual([
      expect.objectContaining({
        provider: "custom-openai",
        id: "custom-chat",
        inputPricePer1M: 1,
      }),
    ]);
    await expect(resolveResponseTarget("custom-openai:custom-chat")).resolves.toBeNull();
    await expect(resolveEmbeddingModel("custom-openai:custom-chat")).resolves.toMatchObject({
      kind: "direct",
      requestedModelId: "custom-openai:custom-chat",
      targets: [{ providerName: "custom-openai", modelId: "custom-chat" }],
    });
    await expect(resolveCompletionModel("custom-openai:custom-chat")).resolves.toMatchObject({
      kind: "direct",
      requestedModelId: "custom-openai:custom-chat",
      targets: [{ providerName: "custom-openai", modelId: "custom-chat" }],
    });
    await expect(resolveImageGenerationModel("custom-openai:custom-chat")).resolves.toMatchObject({
      kind: "direct",
      requestedModelId: "custom-openai:custom-chat",
      targets: [{ providerName: "custom-openai", modelId: "custom-chat" }],
    });
  });

  it("resolves provider models to ordered channel targets with model mapping", async () => {
    mockPrisma.providerChannel.findMany.mockResolvedValueOnce([
      {
        id: "custom-primary",
        provider: "custom-openai",
        name: "Custom primary",
        enabled: true,
        priority: 10,
        weight: 1,
        keyCiphertext: "enc-primary",
        modelMapping: { "public-chat": "custom-chat" },
        settings: { systemPrompt: "Be brief" },
        otherSettings: null,
        paramOverride: { temperature: 0 },
      },
      {
        id: "custom-secondary",
        provider: "custom-openai",
        name: "Custom secondary",
        enabled: true,
        priority: 1,
        weight: 1,
        keyCiphertext: "enc-secondary",
        modelMapping: { "public-chat": "custom-chat" },
        settings: null,
        otherSettings: null,
        paramOverride: null,
      },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([
      {
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [
          {
            modelId: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      },
    ]);
    mockDecrypt.mockReturnValue("custom-key");
    mockPrisma.disabledModel.findMany.mockResolvedValue([]);
    mockPrisma.fallbackGroup.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);

    await initProviders();

    const resolved = await resolveChatModel("custom-openai:public-chat");

    expect(resolved).toMatchObject({
      kind: "direct",
      requestedModelId: "custom-openai:public-chat",
      targets: [
        {
          channelId: "custom-primary",
          channelName: "Custom primary",
          modelId: "public-chat",
          upstreamModelId: "custom-chat",
          settings: { systemPrompt: "Be brief" },
          paramOverride: { temperature: 0 },
        },
        {
          channelId: "custom-secondary",
          channelName: "Custom secondary",
          modelId: "public-chat",
          upstreamModelId: "custom-chat",
        },
      ],
    });
    await expect(listPublicModels()).resolves.toEqual([
      expect.objectContaining({
        provider: "custom-openai",
        id: "custom-chat",
      }),
      expect.objectContaining({
        provider: "custom-openai",
        id: "public-chat",
      }),
    ]);
  });
});

describe("model aliases", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCacheForE2e();
    mockPrisma.providerChannel.findMany.mockRejectedValue(new Error("ProviderChannel missing"));
    mockPrisma.customProvider.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findUnique.mockResolvedValue(null);
  });

  it("lists enabled aliases instead of their target models", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "custom-openai", ciphertext: "enc" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([
      {
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [
          {
            modelId: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      },
    ]);
    mockDecrypt.mockReturnValueOnce("custom-key");
    mockPrisma.disabledModel.findMany.mockResolvedValue([]);
    mockPrisma.fallbackGroup.findMany.mockResolvedValue([]);
    mockPrisma.modelAlias.findMany.mockResolvedValueOnce([
      {
        id: "fast-chat",
        name: "Fast chat",
        targetModelId: "custom-openai:custom-chat",
      },
    ]);

    await initProviders();

    await expect(listPublicModels()).resolves.toEqual([
      expect.objectContaining({
        id: "fast-chat",
        name: "Fast chat",
        provider: "mux",
        type: "alias",
        aliasTargetModelId: "custom-openai:custom-chat",
        inputPricePer1M: 1,
      }),
    ]);
  });

  it("resolves an alias to its concrete target while preserving the requested model id", async () => {
    mockPrisma.providerKey.findMany.mockResolvedValueOnce([
      { provider: "custom-openai", ciphertext: "enc" },
    ]);
    mockPrisma.customProvider.findMany.mockResolvedValueOnce([
      {
        id: "custom-openai",
        name: "Custom OpenAI",
        apiBase: "https://custom.example/v1",
        models: [
          {
            modelId: "custom-chat",
            name: "Custom Chat",
            inputPricePer1M: 1,
            outputPricePer1M: 2,
            contextWindow: 128000,
            maxOutputTokens: 4096,
            inputModalities: ["text"],
            outputModalities: ["text"],
            reasoning: false,
            toolCall: true,
            structuredOutput: true,
            weights: "closed",
          },
        ],
      },
    ]);
    mockDecrypt.mockReturnValueOnce("custom-key");
    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
    mockPrisma.fallbackGroup.findUnique.mockResolvedValue(null);
    mockPrisma.modelAlias.findUnique.mockResolvedValueOnce({
      id: "fast-chat",
      enabled: true,
      targetModelId: "custom-openai:custom-chat",
    });

    await initProviders();

    const resolved = await resolveChatModel("fast-chat");

    expect(resolved).toMatchObject({
      kind: "direct",
      requestedModelId: "fast-chat",
      targets: [{ providerName: "custom-openai", modelId: "custom-chat" }],
    });
  });
});

describe("estimateCost", () => {
  // The providers Map is normally seeded by initProviders() from the
  // ProviderKey table. In this test that side-effect never runs, so
  // getModelPricing always returns null and estimateCost returns undefined.
  // The non-null cost math is covered by the service-level tests in
  // services.test.ts, which mock estimateCost directly and assert the
  // cached_tokens argument is forwarded. Here we only assert the
  // signature and the guard behavior.

  it("returns undefined when no provider is configured for the model", () => {
    expect(estimateCost("openai:gpt-5", 1_000_000, 0, 800_000)).toBeUndefined();
  });

  it("accepts a non-numeric or undefined cached_tokens value", () => {
    expect(() => estimateCost("openai:gpt-5", 0, 0, undefined)).not.toThrow();
    expect(() => estimateCost("openai:gpt-5", 0, 0, NaN)).not.toThrow();
  });

  it("returns undefined for a model id that does not parse as provider:model", () => {
    expect(estimateCost("not-a-model", 100, 100, 50)).toBeUndefined();
  });
});
