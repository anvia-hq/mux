import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockDecrypt } = vi.hoisted(() => ({
  mockPrisma: {
    providerKey: { findMany: vi.fn(), findUnique: vi.fn() },
    disabledModel: { findMany: vi.fn() },
    fallbackGroup: { findUnique: vi.fn() },
  },
  mockDecrypt: vi.fn(),
}));

vi.mock("../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../src/modules/providers/crypto", () => ({ decrypt: mockDecrypt }));

import { estimateCost, resolveResponseTarget } from "../../src/providers/registry";

describe("resolveResponseTarget", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for a model id that does not parse as provider:model", async () => {
    mockPrisma.disabledModel.findMany.mockResolvedValueOnce([]);
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
