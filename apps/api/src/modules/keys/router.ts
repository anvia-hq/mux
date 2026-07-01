import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { createKeySchema, updateKeyModelAccessSchema } from "./schema";
import {
  ApiKeyModelFilterValidationError,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKeyModelAccess,
} from "./services";

/**
 * Hono environment for the keys router. `userId` is set by the admin guard
 * below after a successful role check, so handlers can rely on it being a
 * valid admin user id without re-querying the database.
 */
type KeysRouterEnv = {
  Variables: {
    userId: string;
  };
};

/**
 * Admin-only router for managing API keys.
 *
 * Mounted under `/api-keys` by the main app. Every route requires the caller
 * to be authenticated as a user with the `ADMIN` role; non-admin or
 * unauthenticated callers receive a 401/403 response and never reach the
 * handlers below.
 *
 * Endpoints:
 * - `GET    /`        - List all API keys (newest first)
 * - `POST   /`        - Create a new API key, returning the raw key once
 * - `DELETE /:id`     - Revoke (deactivate) an API key by id
 */
export const keysRouter = new Hono<KeysRouterEnv>();

// Admin-only guard: requires an authenticated ADMIN user.
keysRouter.use("*", async (c, next) => {
  const user = await requireRole(c, "ADMIN");

  if (!user) {
    return c.json({ error: "admin access required" }, 403);
  }

  c.set("userId", user.id);
  await next();
});

/**
 * GET /
 *
 * Lists every API key in the system along with its creator and active state.
 * The raw key material is never returned - only metadata safe to display in
 * the admin dashboard.
 */
keysRouter.get("/", async (c) => {
  try {
    const keys = await listApiKeys();
    return c.json({ keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /
 *
 * Creates a new API key. The raw (unhashed) key is returned exactly once in
 * the response body so the admin can copy it; the database only stores a
 * SHA-256 hash, so the raw value cannot be recovered later.
 */
keysRouter.post("/", zValidator("json", createKeySchema, authValidationHook), async (c) => {
  const { name, spendLimitUsd, allowedModelIds, includeFutureModels } = c.req.valid("json");
  const userId = c.get("userId");

  try {
    const { id, key } = await createApiKey(
      name,
      userId,
      spendLimitUsd,
      allowedModelIds,
      includeFutureModels,
    );
    return c.json({ id, key }, 201);
  } catch (error) {
    if (error instanceof ApiKeyModelFilterValidationError) {
      return c.json({ error: error.message }, 400);
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

keysRouter.patch(
  "/:id/model-access",
  zValidator("json", updateKeyModelAccessSchema, authValidationHook),
  async (c) => {
    const { id } = c.req.param();
    const input = c.req.valid("json");

    try {
      await updateApiKeyModelAccess(id, input);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiKeyModelFilterValidationError) {
        return c.json({ error: error.message }, 400);
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2025"
      ) {
        return c.json({ error: "API key not found" }, 404);
      }

      const message = error instanceof Error ? error.message : "Internal server error";
      return c.json({ error: message }, 500);
    }
  },
);

/**
 * DELETE /:id
 *
 * Revokes an API key by id. Revocation flips `isActive` to false and updates
 * the auth cache so subsequent requests using the key are rejected. The raw
 * key is never exposed, so this operation is idempotent and safe to retry.
 *
 * Returns 404 if no key matches the supplied id.
 */
keysRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    await revokeApiKey(id);
    return c.json({ ok: true });
  } catch (error) {
    // Prisma throws P2025 when the record does not exist.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2025"
    ) {
      return c.json({ error: "API key not found" }, 404);
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});
