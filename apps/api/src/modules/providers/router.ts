import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { prisma } from "../../utils/prisma";
import { encrypt, lastFour } from "./crypto";
import { reloadProvider, listAllModels } from "../../providers/registry";
import type { Model } from "../../providers/types";
import {
  createCustomProviderSchema,
  type CustomProviderModelInput,
  isBuiltInProviderName,
  providerNameSchema,
  providerNames,
  replaceCustomProviderModelsSchema,
  setProviderKeySchema,
  updateCustomProviderSchema,
} from "./schema";
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

function modelCreateData(model: CustomProviderModelInput) {
  return {
    modelId: model.id,
    name: model.name,
    inputPricePer1M: model.inputPricePer1M,
    outputPricePer1M: model.outputPricePer1M,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    reasoning: model.reasoning,
    toolCall: model.toolCall,
    structuredOutput: model.structuredOutput,
    weights: model.weights,
  };
}

function customModelToModel(providerId: string, model: ReturnType<typeof modelCreateData>): Model {
  return {
    id: model.modelId,
    name: model.name,
    provider: providerId,
    inputPricePer1M: model.inputPricePer1M,
    outputPricePer1M: model.outputPricePer1M,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    reasoning: model.reasoning,
    toolCall: model.toolCall,
    structuredOutput: model.structuredOutput,
    weights: model.weights,
  };
}

async function customProviderExists(provider: string): Promise<boolean> {
  const row = await prisma.customProvider.findUnique({
    where: { id: provider },
    select: { id: true },
  });
  return Boolean(row);
}

async function isKnownProvider(provider: string): Promise<boolean> {
  return isBuiltInProviderName(provider) || (await customProviderExists(provider));
}

async function listAdminModelsForProvider(provider: string): Promise<Model[]> {
  const configuredModels = listAllModels().filter((m) => m.provider === provider);
  if (configuredModels.length > 0 || isBuiltInProviderName(provider)) {
    return configuredModels;
  }

  const customProvider = await prisma.customProvider.findUnique({
    where: { id: provider },
    include: { models: { orderBy: { name: "asc" } } },
  });
  if (!customProvider) return [];

  return customProvider.models.map((model) =>
    customModelToModel(customProvider.id, {
      modelId: model.modelId,
      name: model.name,
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      reasoning: model.reasoning,
      toolCall: model.toolCall,
      structuredOutput: model.structuredOutput,
      weights: model.weights === "open" ? "open" : "closed",
    }),
  );
}

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
 * GET /providers/catalog - list built-in providers and custom providers with
 * their configured state. This is the dashboard source of truth.
 */
providersRouter.get("/catalog", async (c) => {
  const [keys, customProviders] = await Promise.all([
    prisma.providerKey.findMany({
      select: {
        provider: true,
        lastFour: true,
        updatedAt: true,
        updater: { select: { email: true } },
      },
    }),
    prisma.customProvider.findMany({
      orderBy: { name: "asc" },
      include: { models: { select: { modelId: true } } },
    }),
  ]);
  const keysByProvider = new Map(keys.map((key) => [key.provider, key]));
  const customProviderIds = new Set(customProviders.map((provider) => provider.id));

  const builtIns = providerNames.map((provider) => {
    const key = keysByProvider.get(provider);
    return {
      provider,
      name: provider,
      type: "built-in" as const,
      configured: Boolean(key),
      lastFour: key?.lastFour ?? null,
      updatedAt: key?.updatedAt ?? null,
      updater: key?.updater ?? null,
      apiBase: null,
      modelCount: null,
    };
  });

  const custom = customProviders.map((provider) => {
    const key = keysByProvider.get(provider.id);
    return {
      provider: provider.id,
      name: provider.name,
      type: "custom" as const,
      configured: Boolean(key),
      lastFour: key?.lastFour ?? null,
      updatedAt: key?.updatedAt ?? null,
      updater: key?.updater ?? null,
      apiBase: provider.apiBase,
      modelCount: provider.models.length,
    };
  });

  const staleConfigured = keys
    .filter((key) => !isBuiltInProviderName(key.provider) && !customProviderIds.has(key.provider))
    .map((key) => ({
      provider: key.provider,
      name: key.provider,
      type: "unknown" as const,
      configured: true,
      lastFour: key.lastFour,
      updatedAt: key.updatedAt,
      updater: key.updater,
      apiBase: null,
      modelCount: null,
    }));

  return c.json({ providers: [...custom, ...builtIns, ...staleConfigured] });
});

providersRouter.post(
  "/custom",
  zValidator("json", createCustomProviderSchema, authValidationHook),
  async (c) => {
    const body = c.req.valid("json");
    const admin = c.get("adminUser");

    const [existingCustomProvider, existingProviderKey] = await Promise.all([
      prisma.customProvider.findUnique({ where: { id: body.id }, select: { id: true } }),
      prisma.providerKey.findUnique({ where: { provider: body.id }, select: { provider: true } }),
    ]);

    if (existingCustomProvider || existingProviderKey) {
      return c.json({ error: `provider already exists: ${body.id}` }, 409);
    }

    await freezeLegacyApiKeyModelAccess();

    const ciphertext = encrypt(body.apiKey);
    const four = lastFour(body.apiKey);

    const provider = await prisma.$transaction(async (tx) => {
      const row = await tx.customProvider.create({
        data: {
          id: body.id,
          name: body.name,
          apiBase: body.apiBase,
          createdBy: admin.id,
          models: { create: body.models.map(modelCreateData) },
        },
        include: { models: { orderBy: { name: "asc" } } },
      });
      await tx.providerKey.create({
        data: {
          provider: body.id,
          ciphertext,
          lastFour: four,
          updatedBy: admin.id,
        },
      });
      return row;
    });

    await reloadProvider(body.id);

    return c.json(
      {
        provider: {
          provider: provider.id,
          name: provider.name,
          type: "custom",
          configured: true,
          lastFour: four,
          apiBase: provider.apiBase,
          modelCount: provider.models.length,
        },
      },
      201,
    );
  },
);

providersRouter.put(
  "/custom/:id",
  zValidator("param", z.object({ id: providerNameSchema }), authValidationHook),
  zValidator("json", updateCustomProviderSchema, authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const admin = c.get("adminUser");

    const existing = await prisma.customProvider.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: `custom provider not found: ${id}` }, 404);
    }

    const data: { name?: string; apiBase?: string } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.apiBase !== undefined) data.apiBase = body.apiBase;

    const existingKey = await prisma.providerKey.findUnique({
      where: { provider: id },
      select: { provider: true },
    });

    if (body.apiKey && !existingKey) {
      await freezeLegacyApiKeyModelAccess();
    }

    const provider = await prisma.$transaction(async (tx) => {
      const row = await tx.customProvider.update({
        where: { id },
        data,
        include: { models: { orderBy: { name: "asc" } } },
      });
      if (body.apiKey) {
        await tx.providerKey.upsert({
          where: { provider: id },
          create: {
            provider: id,
            ciphertext: encrypt(body.apiKey),
            lastFour: lastFour(body.apiKey),
            updatedBy: admin.id,
          },
          update: {
            ciphertext: encrypt(body.apiKey),
            lastFour: lastFour(body.apiKey),
            updatedBy: admin.id,
          },
        });
      }
      return row;
    });

    await reloadProvider(id);

    return c.json({
      provider: {
        provider: provider.id,
        name: provider.name,
        type: "custom",
        configured: Boolean(existingKey || body.apiKey),
        apiBase: provider.apiBase,
        modelCount: provider.models.length,
      },
    });
  },
);

providersRouter.delete(
  "/custom/:id",
  zValidator("param", z.object({ id: providerNameSchema }), authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");

    const existing = await prisma.customProvider.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return c.json({ error: `custom provider not found: ${id}` }, 404);
    }

    await prisma.$transaction([
      prisma.fallbackTarget.deleteMany({ where: { provider: id } }),
      prisma.disabledModel.deleteMany({ where: { provider: id } }),
      prisma.providerKey.deleteMany({ where: { provider: id } }),
      prisma.customProvider.deleteMany({ where: { id } }),
    ]);
    await reloadProvider(id);

    return c.json({ ok: true });
  },
);

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

    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }

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

    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }

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
    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }
    const models = await listAdminModelsForProvider(name);
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

providersRouter.put(
  "/:name/models",
  zValidator("param", z.object({ name: providerNameSchema }), authValidationHook),
  zValidator("json", replaceCustomProviderModelsSchema, authValidationHook),
  async (c) => {
    const { name } = c.req.valid("param");
    const { models } = c.req.valid("json");

    if (isBuiltInProviderName(name)) {
      return c.json({ error: "built-in provider models cannot be edited" }, 400);
    }

    const existing = await prisma.customProvider.findUnique({
      where: { id: name },
      include: { models: { select: { modelId: true } } },
    });
    if (!existing) {
      return c.json({ error: `custom provider not found: ${name}` }, 404);
    }

    const nextIds = new Set(models.map((model) => model.id));
    const removedModelIds = existing.models
      .map((model) => model.modelId)
      .filter((modelId) => !nextIds.has(modelId));

    await prisma.$transaction(async (tx) => {
      await tx.customProviderModel.deleteMany({ where: { providerId: name } });
      await tx.customProviderModel.createMany({
        data: models.map((model) => ({ providerId: name, ...modelCreateData(model) })),
      });
      if (removedModelIds.length > 0) {
        await tx.disabledModel.deleteMany({
          where: { provider: name, modelId: { in: removedModelIds } },
        });
        await tx.fallbackTarget.deleteMany({
          where: { provider: name, modelId: { in: removedModelIds } },
        });
      }
    });

    await reloadProvider(name);

    return c.json({ ok: true });
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

    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }

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
    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }
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
    if (!(await isKnownProvider(name))) {
      return c.json({ error: `unknown provider: ${name}` }, 404);
    }
    const models = await listAdminModelsForProvider(name);
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
