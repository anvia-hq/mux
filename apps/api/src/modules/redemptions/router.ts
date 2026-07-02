import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import type { User } from "../../utils/prisma";
import { getCurrentUser } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import {
  applyRedemptionSchema,
  createRedemptionSchema,
  redeemRedemptionSchema,
  updateRedemptionSchema,
} from "./schema";
import {
  applyRedemptionById,
  createRedemptions,
  deleteRedemption,
  InvalidRedemptionCodeError,
  listRedemptions,
  RedemptionAlreadyAppliedError,
  RedemptionNotFoundError,
  RedemptionTargetNotFoundError,
  redeemRedemptionCode,
  updateRedemption,
} from "./services";

type RedemptionsRouterEnv = {
  Variables: {
    user: User;
  };
};

export const redemptionsRouter = new Hono<RedemptionsRouterEnv>();

redemptionsRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

redemptionsRouter.get("/", async (c) => {
  const admin = requireAdmin(c.get("user"));

  if (!admin) {
    return c.json({ error: "admin access required" }, 403);
  }

  const redemptions = await listRedemptions();
  return c.json({ redemptions });
});

redemptionsRouter.post(
  "/",
  zValidator("json", createRedemptionSchema, authValidationHook),
  async (c) => {
    const admin = requireAdmin(c.get("user"));

    if (!admin) {
      return c.json({ error: "admin access required" }, 403);
    }

    const result = await createRedemptions(admin.id, c.req.valid("json"));
    return c.json(result, 201);
  },
);

redemptionsRouter.post(
  "/redeem",
  zValidator("json", redeemRedemptionSchema, authValidationHook),
  async (c) => {
    const user = c.get("user");

    try {
      const redemption = await redeemRedemptionCode({
        code: c.req.valid("json").code,
        userId: user.id,
      });
      return c.json({ redemption });
    } catch (error) {
      return handleRedemptionError(c, error);
    }
  },
);

redemptionsRouter.patch(
  "/:id",
  zValidator("json", updateRedemptionSchema, authValidationHook),
  async (c) => {
    const admin = requireAdmin(c.get("user"));

    if (!admin) {
      return c.json({ error: "admin access required" }, 403);
    }

    try {
      const redemption = await updateRedemption(c.req.param("id"), c.req.valid("json"));
      return c.json({ redemption });
    } catch (error) {
      return handleRedemptionError(c, error);
    }
  },
);

redemptionsRouter.post(
  "/:id/apply",
  zValidator("json", applyRedemptionSchema, authValidationHook),
  async (c) => {
    const admin = requireAdmin(c.get("user"));

    if (!admin) {
      return c.json({ error: "admin access required" }, 403);
    }

    const input = c.req.valid("json");

    try {
      const redemption = await applyRedemptionById({
        id: c.req.param("id"),
        targetType: input.targetType,
        targetId: input.targetId,
        appliedBy: admin.id,
      });
      return c.json({ redemption });
    } catch (error) {
      return handleRedemptionError(c, error);
    }
  },
);

redemptionsRouter.delete("/:id", async (c) => {
  const admin = requireAdmin(c.get("user"));

  if (!admin) {
    return c.json({ error: "admin access required" }, 403);
  }

  try {
    await deleteRedemption(c.req.param("id"));
    return c.json({ ok: true });
  } catch (error) {
    return handleRedemptionError(c, error);
  }
});

function requireAdmin(user: User) {
  return user.role === "ADMIN" ? user : null;
}

function handleRedemptionError(c: Context, error: unknown) {
  if (error instanceof RedemptionNotFoundError) {
    return c.json({ error: error.message }, 404);
  }

  if (error instanceof RedemptionTargetNotFoundError) {
    return c.json({ error: error.message }, 404);
  }

  if (error instanceof RedemptionAlreadyAppliedError) {
    return c.json({ error: error.message }, 409);
  }

  if (error instanceof InvalidRedemptionCodeError) {
    return c.json({ error: error.message }, 400);
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  return c.json({ error: message }, 500);
}
