import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    redemptionCode: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    redemptionApplication: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => unknown) => callback(tx)),
      redemptionCode: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const { mockInvalidateApiKeyCacheById, mockInvalidateApiKeyCachesForUser } = vi.hoisted(() => ({
  mockInvalidateApiKeyCacheById: vi.fn().mockResolvedValue(undefined),
  mockInvalidateApiKeyCachesForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/modules/keys/services", () => ({
  invalidateApiKeyCacheById: mockInvalidateApiKeyCacheById,
  invalidateApiKeyCachesForUser: mockInvalidateApiKeyCachesForUser,
}));

import {
  applyRedemptionById,
  hashRedemptionCode,
  redeemRedemptionCode,
} from "../../../src/modules/redemptions/services";

describe("redemption services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hashes normalized redemption codes", () => {
    expect(hashRedemptionCode("muxr-abcd-1234")).toBe(hashRedemptionCode("MUXRABCD1234"));
  });

  it("redeems a shared code into user credit", async () => {
    const createdAt = new Date("2026-07-02T00:00:00Z");
    mockTx.redemptionCode.findUnique
      .mockResolvedValueOnce({
        id: "red-1",
        amountUsd: 7,
        status: "ACTIVE",
        expiresAt: null,
        application: null,
      })
      .mockResolvedValueOnce(
        makeAppliedRedemption({
          createdAt,
          targetType: "USER",
          user: { id: "user-1", email: "user@example.com" },
          apiKey: null,
        }),
      );
    mockTx.$executeRaw.mockResolvedValueOnce(1);
    mockTx.redemptionCode.updateMany.mockResolvedValueOnce({ count: 1 });

    const redemption = await redeemRedemptionCode({
      code: "MUXR-ABCD-1234",
      userId: "user-1",
    });

    expect(redemption.status).toBe("used");
    expect(mockTx.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('UPDATE "User"')]),
      7,
      "user-1",
    );
    expect(mockTx.redemptionApplication.create).toHaveBeenCalledWith({
      data: {
        redemptionCodeId: "red-1",
        targetType: "USER",
        userId: "user-1",
        apiKeyId: null,
        appliedBy: "user-1",
      },
    });
    expect(mockInvalidateApiKeyCachesForUser).toHaveBeenCalledWith("user-1");
  });

  it("applies an admin code into API key credit", async () => {
    const createdAt = new Date("2026-07-02T00:00:00Z");
    mockTx.redemptionCode.findUnique
      .mockResolvedValueOnce({
        id: "red-1",
        amountUsd: 12,
        status: "ACTIVE",
        expiresAt: null,
        application: null,
      })
      .mockResolvedValueOnce(
        makeAppliedRedemption({
          createdAt,
          amountUsd: 12,
          targetType: "API_KEY",
          user: null,
          apiKey: {
            id: "key-1",
            name: "service key",
            creator: { email: "owner@example.com" },
          },
        }),
      );
    mockTx.$executeRaw.mockResolvedValueOnce(1);
    mockTx.redemptionCode.updateMany.mockResolvedValueOnce({ count: 1 });

    const redemption = await applyRedemptionById({
      id: "red-1",
      targetType: "API_KEY",
      targetId: "key-1",
      appliedBy: "admin-1",
    });

    expect(redemption.application?.targetType).toBe("API_KEY");
    expect(mockTx.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('UPDATE "ApiKey"')]),
      12,
      "key-1",
    );
    expect(mockTx.redemptionApplication.create).toHaveBeenCalledWith({
      data: {
        redemptionCodeId: "red-1",
        targetType: "API_KEY",
        userId: null,
        apiKeyId: "key-1",
        appliedBy: "admin-1",
      },
    });
    expect(mockInvalidateApiKeyCacheById).toHaveBeenCalledWith("key-1");
  });
});

function makeAppliedRedemption(input: {
  createdAt: Date;
  amountUsd?: number;
  targetType: "USER" | "API_KEY";
  user: { id: string; email: string } | null;
  apiKey: { id: string; name: string; creator: { email: string } } | null;
}) {
  return {
    id: "red-1",
    codeLastFour: "1234",
    name: "onboarding credit",
    amountUsd: input.amountUsd ?? 7,
    status: "USED",
    expiresAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    creator: { email: "admin@example.com" },
    application: {
      targetType: input.targetType,
      createdAt: input.createdAt,
      applier: { email: "admin@example.com" },
      user: input.user,
      apiKey: input.apiKey,
    },
  };
}
