import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { User } from "../../utils/prisma";
import { getCurrentUser } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { createKeySchema, updateKeyModelAccessSchema } from "./schema";
import {
  ApiKeyModelFilterValidationError,
  ApiKeyNotFoundError,
  ApiKeyRevealUnavailableError,
  createApiKey,
  listApiKeys,
  revealApiKey,
  revokeApiKey,
  rotateApiKey,
  updateApiKeyModelAccess,
} from "./services";

/**
 * Hono environment for the keys router. `user` is set by the auth guard below
 * after a successful authentication check, so handlers can apply admin vs owner
 * visibility rules without re-querying the database.
 */
type KeysRouterEnv = {
  Variables: {
    user: User;
  };
};

/**
 * Router for API keys.
 *
 * Mounted under `/api-keys` by the main app. Authenticated regular users can
 * list and reveal their own keys. Admin users can list all keys and perform
 * management actions.
 *
 * Endpoints:
 * - `GET    /`        - List all API keys (newest first)
 * - `POST   /`        - Create a new API key, returning the raw key once
 * - `DELETE /:id`     - Revoke (deactivate) an API key by id
 */
export const keysRouter = new Hono<KeysRouterEnv>();

// Auth guard: any authenticated dashboard user can read owned API keys.
keysRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

function requireAdmin(user: User) {
  return user.role === "ADMIN";
}

/**
 * GET /
 *
 * Lists API keys along with creator and active state. Admins see every key;
 * regular users see only keys they own. Raw key material is never returned
 * from this endpoint.
 */
keysRouter.get("/", async (c) => {
  const user = c.get("user");

  try {
    const keys = await listApiKeys(user.role === "ADMIN" ? {} : { ownerUserId: user.id });
    return c.json({ keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

/**
 * POST /
 *
 * Creates a new API key. Admin-only.
 */
keysRouter.post("/", zValidator("json", createKeySchema, authValidationHook), async (c) => {
  const { name, spendLimitUsd, allowedModelIds, includeFutureModels } = c.req.valid("json");
  const user = c.get("user");

  if (!requireAdmin(user)) {
    return c.json({ error: "admin access required" }, 403);
  }

  try {
    const { id, key } = await createApiKey(
      name,
      user.id,
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

keysRouter.get("/:id/reveal", async (c) => {
  const { id } = c.req.param();
  const user = c.get("user");

  try {
    const result = await revealApiKey({
      id,
      viewer: { id: user.id, role: user.role },
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (error instanceof ApiKeyRevealUnavailableError) {
      return c.json({ error: error.message }, 409);
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

keysRouter.post("/:id/rotate", async (c) => {
  const { id } = c.req.param();
  const user = c.get("user");

  try {
    const result = await rotateApiKey({
      id,
      viewer: { id: user.id, role: user.role },
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (error instanceof ApiKeyRevealUnavailableError) {
      return c.json({ error: error.message }, 409);
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
    const user = c.get("user");

    if (!requireAdmin(user)) {
      return c.json({ error: "admin access required" }, 403);
    }

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
  const user = c.get("user");

  if (!requireAdmin(user)) {
    return c.json({ error: "admin access required" }, 403);
  }

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
