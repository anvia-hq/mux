import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { prisma } from "../../utils/prisma";
import { listAllModels, toFallbackGroupModelId } from "../../providers/registry";

type AdminContext = { Variables: { adminUser: { id: string } } };

const fallbackGroupIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, {
    message:
      "id must use lowercase letters, numbers, dots, underscores, or hyphens, and cannot start or end with punctuation",
  });

const fallbackTargetSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

const fallbackGroupBodySchema = z.object({
  id: fallbackGroupIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
  targets: z.array(fallbackTargetSchema).min(1).max(20),
});

const updateFallbackGroupBodySchema = fallbackGroupBodySchema.omit({ id: true });

async function requireAdmin(c: Context, next: Next) {
  const user = await requireRole(c, "ADMIN");
  if (!user) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("adminUser", { id: user.id });
  await next();
}

function toFallbackGroupDto(group: {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  targets: { provider: string; modelId: string; position: number }[];
}) {
  return {
    id: group.id,
    publicModelId: toFallbackGroupModelId(group.id),
    name: group.name,
    description: group.description,
    enabled: group.enabled,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    targets: group.targets.map((target) => ({
      provider: target.provider,
      modelId: target.modelId,
      publicModelId: `${target.provider}:${target.modelId}`,
      position: target.position,
    })),
  };
}

function validateTargets(targets: { provider: string; modelId: string }[]) {
  const availableModels = new Set(listAllModels().map((model) => `${model.provider}:${model.id}`));
  const seenTargets = new Set<string>();

  for (const target of targets) {
    const key = `${target.provider}:${target.modelId}`;
    if (seenTargets.has(key)) {
      throw new Error(`duplicate fallback target: ${key}`);
    }
    if (!availableModels.has(key)) {
      throw new Error(`unknown or unconfigured fallback target: ${key}`);
    }
    seenTargets.add(key);
  }
}

export const fallbackGroupsRouter = new Hono<AdminContext>();

fallbackGroupsRouter.use("*", requireAdmin);

fallbackGroupsRouter.get("/", async (c) => {
  const groups = await prisma.fallbackGroup.findMany({
    orderBy: { name: "asc" },
    include: { targets: { orderBy: { position: "asc" } } },
  });
  return c.json({ data: groups.map(toFallbackGroupDto) });
});

fallbackGroupsRouter.post(
  "/",
  zValidator("json", fallbackGroupBodySchema, authValidationHook),
  async (c) => {
    const body = c.req.valid("json");

    try {
      validateTargets(body.targets);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid targets" }, 400);
    }

    const existing = await prisma.fallbackGroup.findUnique({ where: { id: body.id } });
    if (existing) {
      return c.json({ error: `fallback group already exists: ${body.id}` }, 409);
    }

    const group = await prisma.fallbackGroup.create({
      data: {
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        enabled: body.enabled,
        targets: {
          create: body.targets.map((target, index) => ({
            provider: target.provider,
            modelId: target.modelId,
            position: index + 1,
          })),
        },
      },
      include: { targets: { orderBy: { position: "asc" } } },
    });

    return c.json({ group: toFallbackGroupDto(group) }, 201);
  },
);

fallbackGroupsRouter.put(
  "/:id",
  zValidator("param", z.object({ id: fallbackGroupIdSchema }), authValidationHook),
  zValidator("json", updateFallbackGroupBodySchema, authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      validateTargets(body.targets);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid targets" }, 400);
    }

    const existing = await prisma.fallbackGroup.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: `fallback group not found: ${id}` }, 404);
    }

    const group = await prisma.$transaction(async (tx) => {
      await tx.fallbackTarget.deleteMany({ where: { groupId: id } });
      return tx.fallbackGroup.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description ?? null,
          enabled: body.enabled,
          targets: {
            create: body.targets.map((target, index) => ({
              provider: target.provider,
              modelId: target.modelId,
              position: index + 1,
            })),
          },
        },
        include: { targets: { orderBy: { position: "asc" } } },
      });
    });

    return c.json({ group: toFallbackGroupDto(group) });
  },
);

fallbackGroupsRouter.delete(
  "/:id",
  zValidator("param", z.object({ id: fallbackGroupIdSchema }), authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    await prisma.fallbackGroup.deleteMany({ where: { id } });
    return c.json({ ok: true });
  },
);
