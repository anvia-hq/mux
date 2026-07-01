import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { requireRole } from "../auth/services";
import { authValidationHook } from "../auth/utils";
import { listPublicNonAliasModels, toPublicModelIdForModel } from "../../providers/registry";
import { prisma } from "../../utils/prisma";

type AdminContext = { Variables: { adminUser: { id: string } } };

const modelAliasIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, {
    message:
      "alias id must use lowercase letters, numbers, dots, underscores, or hyphens, and cannot start or end with punctuation",
  });

const modelAliasBodySchema = z.object({
  id: modelAliasIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  targetModelId: z.string().trim().min(1).max(320),
  enabled: z.boolean().default(true),
});

const updateModelAliasBodySchema = modelAliasBodySchema.omit({ id: true });

async function requireAdmin(c: Context, next: Next) {
  const user = await requireRole(c, "ADMIN");
  if (!user) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("adminUser", { id: user.id });
  await next();
}

function toModelAliasDto(
  alias: {
    id: string;
    name: string;
    description: string | null;
    targetModelId: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  availableTargets: Set<string>,
) {
  return {
    id: alias.id,
    name: alias.name,
    description: alias.description,
    targetModelId: alias.targetModelId,
    targetAvailable: availableTargets.has(alias.targetModelId),
    enabled: alias.enabled,
    createdAt: alias.createdAt,
    updatedAt: alias.updatedAt,
  };
}

async function listAvailableAliasTargets(): Promise<Set<string>> {
  const models = await listPublicNonAliasModels();
  return new Set(models.map((model) => toPublicModelIdForModel(model)));
}

async function validateAliasTarget(targetModelId: string): Promise<string | null> {
  if (!targetModelId.includes(":")) {
    return "targetModelId must reference a provider model or fallback group";
  }

  const availableTargets = await listAvailableAliasTargets();
  if (!availableTargets.has(targetModelId)) {
    return `unknown or unavailable alias target: ${targetModelId}`;
  }

  return null;
}

export const modelAliasesRouter = new Hono<AdminContext>();

modelAliasesRouter.use("*", requireAdmin);

modelAliasesRouter.get("/", async (c) => {
  const [aliases, availableTargets] = await Promise.all([
    prisma.modelAlias.findMany({ orderBy: { name: "asc" } }),
    listAvailableAliasTargets(),
  ]);

  return c.json({ data: aliases.map((alias) => toModelAliasDto(alias, availableTargets)) });
});

modelAliasesRouter.post(
  "/",
  zValidator("json", modelAliasBodySchema, authValidationHook),
  async (c) => {
    const body = c.req.valid("json");
    const targetError = await validateAliasTarget(body.targetModelId);
    if (targetError) {
      return c.json({ error: targetError }, 400);
    }

    const existing = await prisma.modelAlias.findUnique({ where: { id: body.id } });
    if (existing) {
      return c.json({ error: `model alias already exists: ${body.id}` }, 409);
    }

    const alias = await prisma.modelAlias.create({
      data: {
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        targetModelId: body.targetModelId,
        enabled: body.enabled,
      },
    });
    const availableTargets = await listAvailableAliasTargets();

    return c.json({ alias: toModelAliasDto(alias, availableTargets) }, 201);
  },
);

modelAliasesRouter.put(
  "/:id",
  zValidator("param", z.object({ id: modelAliasIdSchema }), authValidationHook),
  zValidator("json", updateModelAliasBodySchema, authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const targetError = await validateAliasTarget(body.targetModelId);
    if (targetError) {
      return c.json({ error: targetError }, 400);
    }

    const existing = await prisma.modelAlias.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: `model alias not found: ${id}` }, 404);
    }

    const alias = await prisma.modelAlias.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description ?? null,
        targetModelId: body.targetModelId,
        enabled: body.enabled,
      },
    });
    const availableTargets = await listAvailableAliasTargets();

    return c.json({ alias: toModelAliasDto(alias, availableTargets) });
  },
);

modelAliasesRouter.delete(
  "/:id",
  zValidator("param", z.object({ id: modelAliasIdSchema }), authValidationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    await prisma.modelAlias.deleteMany({ where: { id } });
    return c.json({ ok: true });
  },
);
