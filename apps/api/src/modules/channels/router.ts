import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { freezeLegacyApiKeyModelAccess } from "../keys/services";
import { encrypt, lastFour } from "../providers/crypto";
import {
  createProviderChannelSchema,
  isBuiltInProviderName,
  providerChannelIdSchema,
  updateProviderChannelSchema,
} from "../providers/schema";
import { reloadProvider, reloadProviderChannel } from "../../providers/registry";
import { Prisma, prisma } from "../../utils/prisma";

type AdminContext = { Variables: { adminUser: { id: string } } };

async function requireAdmin(c: Context, next: Next) {
  const user = await requireRole(c, "ADMIN");
  if (!user) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("adminUser", { id: user.id });
  await next();
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

function channelResponse(row: {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  priority: number;
  weight: number;
  lastFour: string;
  modelMapping?: unknown;
  settings?: unknown;
  otherSettings?: unknown;
  paramOverride?: unknown;
  headerOverride?: unknown;
  updatedAt: Date;
  updater?: { email: string } | null;
}) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    lastFour: row.lastFour,
    modelMapping: row.modelMapping ?? null,
    settings: row.settings ?? null,
    otherSettings: row.otherSettings ?? null,
    paramOverride: row.paramOverride ?? null,
    headerOverride: row.headerOverride ?? null,
    updatedAt: row.updatedAt,
    updater: row.updater ?? null,
  };
}

function jsonCreateValue(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

function jsonUpdateValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export const channelsRouter = new Hono<AdminContext>();

channelsRouter.use("*", requireAdmin);

channelsRouter.get("/", async (c) => {
  const provider = c.req.query("provider");
  if (provider !== undefined) {
    const parsed = z.object({ provider: z.string().min(1) }).safeParse({ provider });
    if (!parsed.success) {
      return c.json({ error: "invalid provider" }, 400);
    }
  }

  const rows = await prisma.providerChannel.findMany({
    where: provider ? { provider } : undefined,
    orderBy: [{ provider: "asc" }, { priority: "desc" }, { weight: "desc" }, { id: "asc" }],
    select: {
      id: true,
      provider: true,
      name: true,
      enabled: true,
      priority: true,
      weight: true,
      lastFour: true,
      modelMapping: true,
      settings: true,
      otherSettings: true,
      paramOverride: true,
      headerOverride: true,
      updatedAt: true,
      updater: { select: { email: true } },
    },
  });

  return c.json({ channels: rows.map(channelResponse) });
});

channelsRouter.post(
  "/",
  zValidator("json", createProviderChannelSchema, authValidationHook),
  async (c) => {
    const body = c.req.valid("json");
    const admin = c.get("adminUser");

    if (!(await isKnownProvider(body.provider))) {
      return c.json({ error: `unknown provider: ${body.provider}` }, 404);
    }

    const existingChannel = await prisma.providerChannel.findUnique({
      where: { id: body.id },
      select: { id: true },
    });
    if (existingChannel) {
      return c.json({ error: `channel already exists: ${body.id}` }, 409);
    }

    const existingProviderChannel = await prisma.providerChannel.findFirst({
      where: { provider: body.provider },
      select: { id: true },
    });
    if (!existingProviderChannel) {
      await freezeLegacyApiKeyModelAccess();
    }

    const ciphertext = encrypt(body.apiKey);
    const four = lastFour(body.apiKey);

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.providerChannel.create({
        data: {
          id: body.id,
          provider: body.provider,
          name: body.name,
          enabled: body.enabled,
          priority: body.priority,
          weight: body.weight,
          keyCiphertext: ciphertext,
          lastFour: four,
          modelMapping: jsonCreateValue(body.modelMapping),
          settings: jsonCreateValue(body.settings),
          otherSettings: jsonCreateValue(body.otherSettings),
          paramOverride: jsonCreateValue(body.paramOverride),
          headerOverride: jsonCreateValue(body.headerOverride),
          createdBy: admin.id,
          updatedBy: admin.id,
        },
        select: {
          id: true,
          provider: true,
          name: true,
          enabled: true,
          priority: true,
          weight: true,
          lastFour: true,
          modelMapping: true,
          settings: true,
          otherSettings: true,
          paramOverride: true,
          headerOverride: true,
          updatedAt: true,
          updater: { select: { email: true } },
        },
      });

      if (body.id === body.provider) {
        await tx.providerKey.upsert({
          where: { provider: body.provider },
          create: {
            provider: body.provider,
            ciphertext,
            lastFour: four,
            updatedBy: admin.id,
          },
          update: {
            ciphertext,
            lastFour: four,
            updatedBy: admin.id,
          },
        });
      }

      return created;
    });

    await reloadProviderChannel(row.id);

    return c.json({ channel: channelResponse(row) }, 201);
  },
);

channelsRouter.put(
  "/:id",
  zValidator("param", z.object({ id: providerChannelIdSchema }), authValidationHook),
  zValidator("json", updateProviderChannelSchema, authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const admin = c.get("adminUser");

    const existing = await prisma.providerChannel.findUnique({
      where: { id },
      select: { id: true, provider: true },
    });
    if (!existing) {
      return c.json({ error: `channel not found: ${id}` }, 404);
    }

    const ciphertext = body.apiKey ? encrypt(body.apiKey) : undefined;
    const four = body.apiKey ? lastFour(body.apiKey) : undefined;

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.providerChannel.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.weight !== undefined ? { weight: body.weight } : {}),
          ...(body.modelMapping !== undefined
            ? { modelMapping: jsonUpdateValue(body.modelMapping) }
            : {}),
          ...(body.settings !== undefined ? { settings: jsonUpdateValue(body.settings) } : {}),
          ...(body.otherSettings !== undefined
            ? { otherSettings: jsonUpdateValue(body.otherSettings) }
            : {}),
          ...(body.paramOverride !== undefined
            ? { paramOverride: jsonUpdateValue(body.paramOverride) }
            : {}),
          ...(body.headerOverride !== undefined
            ? { headerOverride: jsonUpdateValue(body.headerOverride) }
            : {}),
          ...(ciphertext && four
            ? { keyCiphertext: ciphertext, lastFour: four, updatedBy: admin.id }
            : { updatedBy: admin.id }),
        },
        select: {
          id: true,
          provider: true,
          name: true,
          enabled: true,
          priority: true,
          weight: true,
          lastFour: true,
          modelMapping: true,
          settings: true,
          otherSettings: true,
          paramOverride: true,
          headerOverride: true,
          updatedAt: true,
          updater: { select: { email: true } },
        },
      });

      if (id === existing.provider && ciphertext && four) {
        await tx.providerKey.upsert({
          where: { provider: existing.provider },
          create: {
            provider: existing.provider,
            ciphertext,
            lastFour: four,
            updatedBy: admin.id,
          },
          update: {
            ciphertext,
            lastFour: four,
            updatedBy: admin.id,
          },
        });
      }

      return updated;
    });

    await reloadProviderChannel(row.id);

    return c.json({ channel: channelResponse(row) });
  },
);

channelsRouter.delete(
  "/:id",
  zValidator("param", z.object({ id: providerChannelIdSchema }), authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");

    const existing = await prisma.providerChannel.findUnique({
      where: { id },
      select: { id: true, provider: true },
    });
    if (!existing) {
      return c.json({ error: `channel not found: ${id}` }, 404);
    }

    await prisma.$transaction([
      prisma.providerChannel.delete({ where: { id } }),
      ...(id === existing.provider
        ? [prisma.providerKey.deleteMany({ where: { provider: existing.provider } })]
        : []),
    ]);

    await reloadProvider(existing.provider);

    return c.json({ ok: true });
  },
);
