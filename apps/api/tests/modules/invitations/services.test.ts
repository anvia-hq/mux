import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    invitation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { create: vi.fn() },
    apiKey: { create: vi.fn() },
  };

  return {
    mockTx: tx,
    mockPrisma: {
      invitation: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    },
  };
});

const { mockGenerateApiKey } = vi.hoisted(() => ({
  mockGenerateApiKey: vi.fn(() => ({ raw: "mux_live_raw", hashed: "hashed-api-key" })),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../../../src/modules/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-password"),
}));
vi.mock("../../../src/modules/keys/services", () => ({
  buildApiKeyModelAccess: vi.fn().mockResolvedValue({
    allowAllModels: false,
    includeFutureModels: false,
    allowedModelIds: ["openai:gpt-4o"],
  }),
  generateApiKey: mockGenerateApiKey,
}));

import {
  generateInvitationCode,
  hashInvitationCode,
  InvalidInvitationCodeError,
  redeemInvitation,
  revokeInvitation,
  InvitationAlreadyRedeemedError,
  createInvitation,
} from "../../../src/modules/invitations/services";

const baseInvitation = {
  id: "invite-1",
  codeHash: "hash",
  codeLastFour: "ABCD",
  balanceUsd: 5,
  isActive: true,
  createdBy: "admin-1",
  redeemedBy: null,
  redeemedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  creator: { email: "admin@test.com" },
  redeemer: null,
};

describe("invitation services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("generates normalized, hashable invite codes", () => {
    const code = generateInvitationCode();
    expect(code.raw).toMatch(/^MUX-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code.hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(code.lastFour).toHaveLength(4);
    expect(hashInvitationCode(code.raw.toLowerCase())).toBe(code.hashed);
  });

  it("creates an invitation and returns the raw code once", async () => {
    mockPrisma.invitation.create.mockResolvedValueOnce(baseInvitation);

    const result = await createInvitation("admin-1", 5);

    expect(result.code).toMatch(/^MUX-/);
    expect(result.invitation).toMatchObject({
      id: "invite-1",
      balanceUsd: 5,
      status: "pending",
    });
    expect(mockPrisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdBy: "admin-1",
          balanceUsd: 5,
          codeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("rejects revoking redeemed invitations", async () => {
    mockPrisma.invitation.findUnique.mockResolvedValueOnce({
      ...baseInvitation,
      redeemedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await expect(revokeInvitation("invite-1")).rejects.toBeInstanceOf(
      InvitationAlreadyRedeemedError,
    );
    expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
  });

  it("redeems an invitation into a user and API key transaction", async () => {
    mockTx.invitation.findUnique.mockResolvedValueOnce({
      ...baseInvitation,
      creator: undefined,
      redeemer: undefined,
    });
    mockTx.invitation.updateMany.mockResolvedValueOnce({ count: 1 });
    mockTx.user.create.mockResolvedValueOnce({
      id: "user-1",
      email: "new@test.com",
      name: null,
      role: "USER",
      passwordHash: "hashed-password",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.apiKey.create.mockResolvedValueOnce({
      id: "key-1",
      spendLimitUsd: 5,
    });
    mockTx.invitation.update.mockResolvedValueOnce({});

    const result = await redeemInvitation({
      invitationCode: "MUX-TEST",
      email: "new@test.com",
      password: "password123",
      name: null,
    });

    expect(result.apiKey).toEqual({ id: "key-1", key: "mux_live_raw", spendLimitUsd: 5 });
    expect(mockTx.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", isActive: true, redeemedAt: null },
      data: { isActive: false },
    });
    expect(mockTx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@test.com",
          role: "USER",
          passwordHash: "hashed-password",
        }),
      }),
    );
    expect(mockTx.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: "hashed-api-key",
          spendLimitUsd: 5,
          allowAllModels: false,
          includeFutureModels: false,
          allowedModelIds: ["openai:gpt-4o"],
          invitationId: "invite-1",
        }),
      }),
    );
  });

  it("rejects inactive, missing, or already redeemed codes", async () => {
    mockTx.invitation.findUnique.mockResolvedValueOnce(null);

    await expect(
      redeemInvitation({
        invitationCode: "missing",
        email: "new@test.com",
        password: "password123",
        name: null,
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationCodeError);
  });
});
