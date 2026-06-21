import { describe, expect, it } from "vitest";

import { normalizeEmail, normalizeName, sanitizeUser, isUniqueConstraintError, getValidationErrorMessage } from "./utils";

describe("auth utils", () => {
  describe("normalizeEmail", () => {
    it("trims and lowercases email", () => {
      expect(normalizeEmail("  User@Example.com  ")).toBe("user@example.com");
    });
  });

  describe("normalizeName", () => {
    it("trims name", () => {
      expect(normalizeName("  Test User  ")).toBe("Test User");
    });
    it("returns null for nullish values", () => {
      expect(normalizeName(null)).toBeNull();
      expect(normalizeName(undefined)).toBeNull();
    });
    it("returns null for whitespace-only name", () => {
      expect(normalizeName("   ")).toBeNull();
    });
  });

  describe("sanitizeUser", () => {
    it("strips passwordHash from user", () => {
      const user = {
        id: "1",
        email: "test@example.com",
        name: "Test",
        passwordHash: "secret",
        role: "USER" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const sanitized = sanitizeUser(user);
      expect(sanitized).not.toHaveProperty("passwordHash");
      expect(sanitized.id).toBe("1");
      expect(sanitized.email).toBe("test@example.com");
    });
  });

  describe("isUniqueConstraintError", () => {
    it("returns true for P2002 error", () => {
      expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    });
    it("returns false for other objects", () => {
      expect(isUniqueConstraintError({ code: "OTHER" })).toBe(false);
      expect(isUniqueConstraintError(null)).toBe(false);
      expect(isUniqueConstraintError("string")).toBe(false);
    });
  });

  describe("getValidationErrorMessage", () => {
    it("returns first issue message", () => {
      expect(getValidationErrorMessage({ issues: [{ message: "missing field" }] })).toBe("missing field");
    });
    it("returns default when no issues", () => {
      expect(getValidationErrorMessage({ issues: [] })).toBe("invalid request body");
    });
  });
});