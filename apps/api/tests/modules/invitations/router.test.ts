import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
  },
}));

const { mockCreateInvitation, mockListInvitations, mockRevokeInvitation } = vi.hoisted(() => ({
  mockCreateInvitation: vi.fn(),
  mockListInvitations: vi.fn(),
  mockRevokeInvitation: vi.fn(),
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("hono/jwt", () => ({
  verify: vi.fn().mockResolvedValue({ sub: "admin-1", role: "ADMIN" }),
}));
vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue("jwt"),
}));
vi.mock("../../../src/modules/invitations/services", () => {
  class InvitationNotFoundError extends Error {
    constructor() {
      super("invitation not found");
      this.name = "InvitationNotFoundError";
    }
  }

  class InvitationAlreadyRedeemedError extends Error {
    constructor() {
      super("redeemed invitation cannot be revoked");
      this.name = "InvitationAlreadyRedeemedError";
    }
  }

  return {
    createInvitation: mockCreateInvitation,
    listInvitations: mockListInvitations,
    revokeInvitation: mockRevokeInvitation,
    InvitationNotFoundError,
    InvitationAlreadyRedeemedError,
  };
});

import { invitationsRouter } from "../../../src/modules/invitations/router";
import {
  InvitationAlreadyRedeemedError,
  InvitationNotFoundError,
} from "../../../src/modules/invitations/services";

describe("invitations router", () => {
  afterEach(() => vi.clearAllMocks());

  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      name: "Admin",
      role: "ADMIN",
      passwordHash: "h",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("GET / returns invitation list", async () => {
    mockListInvitations.mockResolvedValueOnce([]);
    const app = new Hono().route("/invitations", invitationsRouter);
    const res = await app.request("/invitations");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ invitations: [] });
  });

  it("POST / creates an invitation", async () => {
    mockCreateInvitation.mockResolvedValueOnce({
      invitation: { id: "invite-1", balanceUsd: 5 },
      code: "MUX-TEST",
    });
    const app = new Hono().route("/invitations", invitationsRouter);
    const res = await app.request("/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balanceUsd: 5 }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateInvitation).toHaveBeenCalledWith("admin-1", 5);
    await expect(res.json()).resolves.toEqual({
      invitation: { id: "invite-1", balanceUsd: 5 },
      code: "MUX-TEST",
    });
  });

  it("POST / rejects invalid balances", async () => {
    const app = new Hono().route("/invitations", invitationsRouter);
    const res = await app.request("/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balanceUsd: 0 }),
    });

    expect(res.status).toBe(400);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("DELETE /:id revokes an invitation", async () => {
    mockRevokeInvitation.mockResolvedValueOnce({ id: "invite-1" });
    const app = new Hono().route("/invitations", invitationsRouter);
    const res = await app.request("/invitations/invite-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockRevokeInvitation).toHaveBeenCalledWith("invite-1");
  });

  it("DELETE /:id returns 404 or 409 for known revoke failures", async () => {
    const app = new Hono().route("/invitations", invitationsRouter);

    mockRevokeInvitation.mockRejectedValueOnce(new InvitationNotFoundError());
    expect((await app.request("/invitations/missing", { method: "DELETE" })).status).toBe(404);

    mockRevokeInvitation.mockRejectedValueOnce(new InvitationAlreadyRedeemedError());
    expect((await app.request("/invitations/redeemed", { method: "DELETE" })).status).toBe(409);
  });
});
