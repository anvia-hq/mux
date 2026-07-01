import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { prisma } from "../../utils/prisma";
import { encrypt, lastFour } from "./crypto";
import { reloadProvider, listAllModels } from "../../providers/registry";
import { providerNameSchema, setProviderKeySchema } from "./schema";
import { freezeLegacyApiKeyModelAccess } from "../keys/services";

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
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  zValidator("json", setProviderKeySchema, authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    const { apiKey } = c.req.valid("json");
    const admin = c.get("adminUser");

    const ciphertext = encrypt(apiKey);
    const four = lastFour(apiKey);
    const existingProvider = await prisma.providerKey.findUnique({
      where: { provider: name },
      select: { provider: true },
    });

    if (!existingProvider) {
      await freezeLegacyApiKeyModelAccess();
    }

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
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");

    await prisma.providerKey.deleteMany({ where: { provider: name } });
    await reloadProvider(name);

    return c.json({ ok: true });
  },
);

/**
 * GET /providers/:name/models - list all models for a provider with their
 * enabled/disabled state.
 */
providersRouter.get(
  "/:name/models",
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    const models = listAllModels().filter((m) => m.provider === name);
    const disabled = new Set(
      (
        await prisma.disabledModel.findMany({
          where: { provider: name },
          select: { modelId: true },
        })
      ).map((r) => r.modelId),
    );
    return c.json({
      data: models.map((m) => ({ ...m, enabled: !disabled.has(m.id) })),
    });
  },
);

/**
 * PUT /providers/:name/models/toggle - enable or disable a single model.
 */
providersRouter.put(
  "/:name/models/toggle",
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  zValidator(
    "json",
    z.object({ modelId: z.string().min(1), enabled: z.boolean() }),
    authValidationHook,
  ),
  async (c) => {
    const { name } = c.req.valid("param");
    const { modelId, enabled } = c.req.valid("json");

    if (enabled) {
      await prisma.disabledModel.deleteMany({
        where: { provider: name, modelId },
      });
    } else {
      await prisma.disabledModel.upsert({
        where: { modelId_provider: { modelId, provider: name } },
        create: { modelId, provider: name },
        update: {},
      });
    }

    return c.json({ ok: true });
  },
);

/**
 * PUT /providers/:name/models/enable-all - enable every model for a provider.
 */
providersRouter.put(
  "/:name/models/enable-all",
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    await prisma.disabledModel.deleteMany({ where: { provider: name } });
    return c.json({ ok: true });
  },
);

/**
 * PUT /providers/:name/models/disable-all - disable every model for a provider.
 */
providersRouter.put(
  "/:name/models/disable-all",
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    const models = listAllModels().filter((m) => m.provider === name);
    for (const m of models) {
      await prisma.disabledModel.upsert({
        where: { modelId_provider: { modelId: m.id, provider: name } },
        create: { modelId: m.id, provider: name },
        update: {},
      });
    }
    return c.json({ ok: true });
  },
);
