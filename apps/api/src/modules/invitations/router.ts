import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { createInvitationSchema, updateInvitationSettingsSchema } from "./schema";
import {
  createInvitation,
  getInvitationSettings,
  InvitationAlreadyRedeemedError,
  InvitationNotFoundError,
  listInvitations,
  revokeInvitation,
  updateInvitationSettings,
} from "./services";

type InvitationsRouterEnv = {
  Variables: {
    userId: string;
  };
};

export const invitationsRouter = new Hono<InvitationsRouterEnv>();

invitationsRouter.use("*", async (c, next) => {
  const user = await requireRole(c, "ADMIN");

  if (!user) {
    return c.json({ error: "admin access required" }, 403);
  }

  c.set("userId", user.id);
  await next();
});

invitationsRouter.get("/", async (c) => {
  const invitations = await listInvitations();
  return c.json({ invitations });
});

invitationsRouter.get("/settings", async (c) => {
  const settings = await getInvitationSettings();
  return c.json(settings);
});

invitationsRouter.patch(
  "/settings",
  zValidator("json", updateInvitationSettingsSchema, authValidationHook),
  async (c) => {
    const settings = await updateInvitationSettings(c.req.valid("json"));
    return c.json(settings);
  },
);

invitationsRouter.post(
  "/",
  zValidator("json", createInvitationSchema, authValidationHook),
  async (c) => {
    const { balanceUsd, maxRedemptions } = c.req.valid("json");
    const createdBy = c.get("userId");
    const result = await createInvitation(createdBy, balanceUsd, maxRedemptions);

    return c.json(result, 201);
  },
);

invitationsRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    await revokeInvitation(id);
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof InvitationNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (error instanceof InvitationAlreadyRedeemedError) {
      return c.json({ error: error.message }, 409);
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});
