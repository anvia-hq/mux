import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../../src/utils/prisma", () => ({ prisma: mockPrisma }));

vi.mock("hono/cookie", () => ({
  getCookie: vi.fn().mockReturnValue(null),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("../../../src/modules/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  verifyPassword: vi.fn().mockImplementation((pw: string) => pw === "correct"),
}));

import {
  authenticateUser,
  createAdminUser,
  createUserAccount,
  getUserCount,
} from "../../../src/modules/auth/services";

describe("auth services", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("authenticateUser", () => {
    it("returns user on valid credentials", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "1",
        email: "test@example.com",
        passwordHash: "hashed-password",
      });
      const user = await authenticateUser("test@example.com", "correct");
      expect(user).toBeDefined();
    });

    it("returns null when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const user = await authenticateUser("test@example.com", "correct");
      expect(user).toBeNull();
    });
  });

  describe("createUserAccount", () => {
    it("creates user with USER role", async () => {
      mockPrisma.user.create.mockResolvedValueOnce({ id: "1" });
      await createUserAccount({ email: "test@example.com", password: "secret", name: "Test" });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "test@example.com",
            role: "USER",
          }),
        }),
      );
    });
  });

  describe("createAdminUser", () => {
    it("creates user with ADMIN role", async () => {
      mockPrisma.user.create.mockResolvedValueOnce({ id: "1" });
      await createAdminUser({ email: "admin@example.com", password: "secret", name: "Admin" });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: "ADMIN" }),
        }),
      );
    });
  });

  describe("getUserCount", () => {
    it("returns user count", async () => {
      mockPrisma.user.count.mockResolvedValueOnce(5);
      const count = await getUserCount();
      expect(count).toBe(5);
    });
  });
});
