import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockDecrypt } = vi.hoisted(() => ({
  mockPrisma: {
    providerKey: { findMany: vi.fn(), findUnique: vi.fn() },
    disabledModel: { findMany: vi.fn() },
    fallbackGroup: { findUnique: vi.fn() },
  },
  mockDecrypt: vi.fn(),
}));

vi.mock("../utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../modules/providers/crypto", () => ({ decrypt: mockDecrypt }));

import { resolveResponseTarget } from "./registry";

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
