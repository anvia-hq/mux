import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { listUsers } from "../../../src/modules/users/services";

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
});
