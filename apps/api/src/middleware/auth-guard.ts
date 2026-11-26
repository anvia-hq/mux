import type { AuthenticatedUser, SessionResolver } from "../auth";
import { ForbiddenError, UnauthorizedError } from "../errors";

export const requireSession = async (
  sessionResolver: SessionResolver,
  headers: Headers,
): Promise<AuthenticatedUser> => {
  const user = await sessionResolver.getSessionUser(headers);

  if (!user) {
    throw new UnauthorizedError("Valid user session is required.");
  }

  return user;
};

export const requireAdmin = async (
  sessionResolver: SessionResolver,
  headers: Headers,
): Promise<AuthenticatedUser> => {
  const user = await requireSession(sessionResolver, headers);

  if (user.role !== "admin") {
    throw new ForbiddenError("Admin role is required for this action.");
  }

  return user;
};

export const extractBearerToken = (headers: Headers): string | null => {
  const header = headers.get("authorization");

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  if (!match) {
    return null;
  }

  return match[1];
};
