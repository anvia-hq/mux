import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { prisma } from "../../utils/prisma";
import { encrypt, lastFour } from "./crypto";
import { reloadProvider } from "../../providers/registry";
import { providerNameSchema, setProviderKeySchema } from "./schema";

type AdminContext = { Variables: { adminUser: { id: string } } };

async function requireAdmin(c: Context, next: Next) {
  const user = await requireRole(c, "ADMIN");
  if (!user) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("adminUser", { id: user.id });
  await next();
}

export const providersRouter = new Hono<AdminContext>();

providersRouter.use("*", requireAdmin);

/**
 * GET /providers - list configured providers with last-4 of the key.
 */
providersRouter.get("/", async (c) => {
  const rows = await prisma.providerKey.findMany({
    orderBy: { provider: "asc" },
    select: {
      provider: true,
      lastFour: true,
      updatedAt: true,
      updater: { select: { email: true } },
    },
  });
  return c.json({ providers: rows });
});

/**
 * PUT /providers/:name - create or replace a key. Encrypts at rest, then
 * reloads the in-memory adapter so the change applies immediately.
 */
providersRouter.put(
  "/:name",
  zValidator(
    "param",
    z.object({ name: providerNameSchema }),
    authValidationHook,
  ),
  zValidator("json", setProviderKeySchema, authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    const { apiKey } = c.req.valid("json");
    const admin = c.get("adminUser");

    const ciphertext = encrypt(apiKey);
    const four = lastFour(apiKey);

    const row = await prisma.providerKey.upsert({
      where: { provider: name },
      create: { provider: name, ciphertext, lastFour: four, updatedBy: admin.id },
      update: { ciphertext, lastFour: four, updatedBy: admin.id },
    });

    await reloadProvider(name);

    return c.json({
      provider: {
        provider: row.provider,
        lastFour: row.lastFour,
        updatedAt: row.updatedAt,
      },
    });
  },
);

/**
 * DELETE /providers/:name - remove a key.
 */
providersRouter.delete(
  "/:name",
  zValidator(
    "param",
    z.object({ name: providerNameSchema }),
    authValidationHook,
  ),
  async (c) => {
    const { name } = c.req.valid("param");

    await prisma.providerKey.deleteMany({ where: { provider: name } });
    await reloadProvider(name);

    return c.json({ ok: true });
  },
);
