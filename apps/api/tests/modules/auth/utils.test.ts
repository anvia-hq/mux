import { describe, expect, it, vi } from "vitest";

import {
  normalizeEmail,
  normalizeName,
  sanitizeUser,
  isUniqueConstraintError,
  getValidationErrorMessage,
  authValidationHook,
} from "../../../src/modules/auth/utils";

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
      expect(getValidationErrorMessage({ issues: [{ message: "missing field" }] })).toBe(
        "missing field",
      );
    });
    it("returns default when no issues", () => {
      expect(getValidationErrorMessage({ issues: [] })).toBe("invalid request body");
    });
  });

  describe("authValidationHook — rich 400 envelope", () => {
    function makeContext() {
      return {
        json: vi.fn((body: unknown, status: number) => ({ body, status })),
      } as unknown as Parameters<typeof authValidationHook>[1];
    }

    it("returns nothing on success", () => {
      const c = makeContext();
      const result = authValidationHook({ success: true }, c);
      expect(result).toBeUndefined();
      expect(c.json).not.toHaveBeenCalled();
    });

    it("returns OpenAI envelope for missing field (invalid_type)", () => {
      const c = makeContext();
      const result = authValidationHook(
        {
          success: false,
          error: {
            issues: [
              {
                code: "invalid_type",
                path: ["model"],
                message: "model is required",
              } as never,
            ],
          },
        },
        c,
      );
      expect(c.json).toHaveBeenCalledWith(
        {
          error: {
            message: "model is required",
            type: "invalid_request_error",
            param: "model",
            code: "invalid_value",
          },
        },
        400,
      );
      expect(result).toEqual({
        body: {
          error: {
            message: "model is required",
            type: "invalid_request_error",
            param: "model",
            code: "invalid_value",
          },
        },
        status: 400,
      });
    });

    it("returns param from nested path", () => {
      const c = makeContext();
      authValidationHook(
        {
          success: false,
          error: {
            issues: [
              {
                code: "too_small",
                path: ["tools", 0, "vector_store_ids"],
                message: "must have at least 1",
              } as never,
            ],
          },
        },
        c,
      );
      expect(c.json).toHaveBeenCalledWith(
        {
          error: {
            message: "must have at least 1",
            type: "invalid_request_error",
            param: "tools.0.vector_store_ids",
            code: "out_of_range",
          },
        },
        400,
      );
    });

    it("maps unrecognized_keys to unrecognized_parameter", () => {
      const c = makeContext();
      authValidationHook(
        {
          success: false,
          error: {
            issues: [
              {
                code: "unrecognized_keys",
                path: ["unknown_field"],
                message: "unrecognized key",
                keys: ["unknown_field"],
              } as never,
            ],
          },
        },
        c,
      );
      expect(c.json).toHaveBeenCalledWith(
        {
          error: {
            message: "unrecognized key",
            type: "invalid_request_error",
            param: "unknown_field",
            code: "unrecognized_parameter",
          },
        },
        400,
      );
    });

    it("uses null param when path is empty", () => {
      const c = makeContext();
      authValidationHook(
        {
          success: false,
          error: {
            issues: [{ code: "custom", path: [], message: "bad" } as never],
          },
        },
        c,
      );
      expect(c.json).toHaveBeenCalledWith(
        {
          error: {
            message: "bad",
            type: "invalid_request_error",
            param: null,
            code: "invalid_value",
          },
        },
        400,
      );
    });

    it("falls back to default message when no issues", () => {
      const c = makeContext();
      authValidationHook({ success: false, error: { issues: [] } }, c);
      expect(c.json).toHaveBeenCalledWith(
        {
          error: {
            message: "invalid request body",
            type: "invalid_request_error",
            param: null,
            code: "invalid_value",
          },
        },
        400,
      );
    });
  });
});
