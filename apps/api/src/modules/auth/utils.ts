import type { Context } from "hono";
import type { ZodIssue } from "zod";
import type { User } from "../../utils/prisma";
import type { SanitizedUser } from "./types";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string | null | undefined) {
  const normalized = name?.trim();

  return normalized || null;
}

export function sanitizeUser(user: User): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function getValidationErrorMessage(error: { issues: Array<{ message: string }> }) {
  return error.issues[0]?.message ?? "invalid request body";
}

/**
 * Map a Zod issue code to an OpenAI-style error code. The OpenAI Responses
 * API returns one of: `invalid_value`, `unrecognized_parameter`,
 * `out_of_range`, `invalid_type`. Anything else collapses to
 * `invalid_value` to keep the envelope stable.
 */
function mapZodCodeToOpenAI(code: ZodIssue["code"] | undefined): string {
  switch (code) {
    case "invalid_type":
    case "invalid_value":
    case "invalid_format":
    case "invalid_union":
    case "invalid_key":
    case "invalid_element":
    case "not_multiple_of":
      return "invalid_value";
    case "unrecognized_keys":
      return "unrecognized_parameter";
    case "too_small":
    case "too_big":
      return "out_of_range";
    default:
      return "invalid_value";
  }
}

function issueParamPath(issue: ZodIssue | undefined): string | null {
  if (!issue?.path || issue.path.length === 0) return null;
  return issue.path.join(".");
}

export function authValidationHook(
  result:
    | { success: true }
    | { success: false; error: { issues: Array<ZodIssue> } },
  c: Context,
) {
  if (result.success) return;
  const issue = result.error.issues[0];
  return c.json(
    {
      error: {
        message: issue?.message ?? "invalid request body",
        type: "invalid_request_error",
        param: issueParamPath(issue),
        code: mapZodCodeToOpenAI(issue?.code),
      },
    },
    400,
  );
}
