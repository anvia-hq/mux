import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { listUsers, promoteUserToAdmin } from "../../../src/modules/users/services";

describe("users services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns sanitized users", async () => {
    const date = new Date();
    mockPrisma.user.findMany.mockResolvedValueOnce([
      {
        id: "1",
        email: "a@b.com",
        name: "User",
        passwordHash: "hash",
        role: "USER",
        createdAt: date,
        updatedAt: date,
      },
    ]);
    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).not.toHaveProperty("passwordHash");
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
  });

  it("promotes a regular user to admin", async () => {
    const date = new Date();
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      passwordHash: "hash",
      role: "USER",
      spendLimitUsd: null,
      createdAt: date,
      updatedAt: date,
    });
    mockPrisma.user.update.mockResolvedValueOnce({
      id: "user-1",
      email: "user@test.com",
      name: "User",
      passwordHash: "hash",
      role: "ADMIN",
      spendLimitUsd: null,
      createdAt: date,
      updatedAt: date,
    });

    const user = await promoteUserToAdmin("user-1");

    expect(user?.role).toBe("ADMIN");
    expect(user).not.toHaveProperty("passwordHash");
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADMIN" },
    });
  });

  it("returns null when the promoted user does not exist", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const user = await promoteUserToAdmin("missing-user");

    expect(user).toBeNull();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns existing admins without updating them", async () => {
    const date = new Date();
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "admin-2",
      email: "other-admin@test.com",
      name: "Other Admin",
      passwordHash: "hash",
      role: "ADMIN",
      spendLimitUsd: null,
      createdAt: date,
      updatedAt: date,
    });

    const user = await promoteUserToAdmin("admin-2");

    expect(user?.role).toBe("ADMIN");
    expect(user).not.toHaveProperty("passwordHash");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
