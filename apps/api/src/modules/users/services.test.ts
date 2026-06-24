import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../utils/prisma", () => ({ prisma: mockPrisma }));

import { listRecentUsers } from "./services";

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
    const users = await listRecentUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).not.toHaveProperty("passwordHash");
  });
});
