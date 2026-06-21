import { describe, expect, it } from "vitest";
import {
  getValidationErrorMessage,
  isUniqueConstraintError,
  normalizeEmail,
  normalizeName,
  sanitizeUser,
} from "./utils";

describe("auth utils", () => {
  it("normalizes emails and optional names", () => {
    expect(normalizeEmail("  USER@Example.COM  ")).toBe("user@example.com");
    expect(normalizeName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });

  it("removes sensitive fields from users", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");

    const sanitized = sanitizeUser({
      id: "user_1",
      email: "user@example.com",
      name: "User",
      role: "USER",
      passwordHash: "secret",
      createdAt,
      updatedAt,
    });

    expect(sanitized).toEqual({
      id: "user_1",
      email: "user@example.com",
      name: "User",
      role: "USER",
      createdAt,
      updatedAt,
    });
    expect(sanitized).not.toHaveProperty("passwordHash");
  });

  it("detects Prisma unique constraint errors", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2003" })).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });

  it("returns the first validation error message with a fallback", () => {
    expect(getValidationErrorMessage({ issues: [{ message: "email is required" }] })).toBe(
      "email is required",
    );
    expect(getValidationErrorMessage({ issues: [] })).toBe("invalid request body");
  });
});
