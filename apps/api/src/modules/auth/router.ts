import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { loginSchema, onboardSchema, registerSchema } from "./schema";
import {
  authenticateUser,
  clearAuthCookie,
  createAdminUser,
  getCurrentUser,
  getUserCount,
  setAuthCookie,
} from "./services";
import { authValidationHook, isUniqueConstraintError, sanitizeUser } from "./utils";
import {
  getInvitationSettings,
  InvalidInvitationCodeError,
  redeemInvitation,
} from "../invitations/services";

export const authRouter = new Hono()
  .get("/onboarding-status", async (c) => {
    const count = await getUserCount();
    const settings = await getInvitationSettings();
    return c.json({ needsOnboarding: count === 0, ...settings });
  })
  .post("/onboard", zValidator("json", onboardSchema, authValidationHook), async (c) => {
    const input = c.req.valid("json");

    // Only allow onboarding when no users exist (first-run setup)
    const userCount = await getUserCount();
    if (userCount > 0) {
      return c.json({ error: "onboarding is only available when no users exist" }, 403);
    }

    try {
      const user = await createAdminUser({
        email: input.email,
        password: input.password,
        name: input.name,
      });

      await setAuthCookie(c, user);

      return c.json({ user: sanitizeUser(user) }, 201);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return c.json({ error: "email is already registered" }, 409);
      }

      throw error;
    }
  })
  .post("/login", zValidator("json", loginSchema, authValidationHook), async (c) => {
    const input = c.req.valid("json");
    const user = await authenticateUser(input.email, input.password);

    if (!user) {
      return c.json({ error: "invalid email or password" }, 401);
    }

    // Clear any existing cookie (including stale Secure cookies that the browser
    // may be holding from a previous deployment) before issuing a fresh one.
    clearAuthCookie(c);
    await setAuthCookie(c, user);

    return c.json({ user: sanitizeUser(user) });
  })
  .post("/logout", (c) => {
    clearAuthCookie(c);

    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const user = await getCurrentUser(c);

    if (!user) {
      return c.json({ error: "unauthorized" }, 401);
    }

    return c.json({ user: sanitizeUser(user) });
  })
  .post("/register", zValidator("json", registerSchema, authValidationHook), async (c) => {
    const input = c.req.valid("json");
    const settings = await getInvitationSettings();

    if (!settings.inviteRegistrationEnabled) {
      return c.json({ error: "invite-code registration is disabled" }, 403);
    }

    try {
      const result = await redeemInvitation({
        invitationCode: input.invitationCode,
        email: input.email,
        password: input.password,
        name: input.name,
      });

      await setAuthCookie(c, result.user);

      return c.json(
        {
          user: sanitizeUser(result.user),
          apiKey: result.apiKey,
        },
        201,
      );
    } catch (error) {
      if (error instanceof InvalidInvitationCodeError) {
        return c.json({ error: error.message }, 403);
      }

      if (isUniqueConstraintError(error)) {
        return c.json({ error: "email is already registered" }, 409);
      }

      throw error;
    }
  });
