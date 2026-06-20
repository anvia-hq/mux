import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { requireRole } from "../auth/services";
import type { Role, User } from "../../utils/prisma";
import { authValidationHook, isUniqueConstraintError } from "../auth/utils";
import {
  addPromptVersion,
  createPromptWithFirstVersion,
  getPromptWithVersions,
  listPrompts,
  setActiveVersion,
} from "./services";
import { createPromptSchema, createVersionSchema, setActiveVersionSchema } from "./schema";

type AdminContext = { Variables: { adminUser: User & { role: Role } } };

async function requireAdmin(c: Context, next: Next) {
  const user = await requireRole(c, "ADMIN");
  if (!user) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("adminUser", user);
  await next();
}

export const promptsRouter = new Hono<AdminContext>();

promptsRouter.use("*", requireAdmin);

promptsRouter.get("/", async (c) => {
  const prompts = await listPrompts();
  return c.json({ prompts });
});

promptsRouter.post(
  "/",
  zValidator("json", createPromptSchema, authValidationHook),
  async (c) => {
    const input = c.req.valid("json");
    const user = c.get("adminUser");

    try {
      const prompt = await createPromptWithFirstVersion({
        name: input.name,
        description: input.description ?? null,
        content: input.content,
        model: input.model ?? null,
        temperature: input.temperature ?? null,
        notes: input.notes ?? null,
        userId: user.id,
      });
      return c.json({ prompt }, 201);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return c.json({ error: "a prompt with that name already exists" }, 409);
      }
      throw error;
    }
  },
);

promptsRouter.get("/:id", async (c) => {
  const { id } = c.req.param();
  const prompt = await getPromptWithVersions(id);

  if (!prompt) {
    return c.json({ error: "prompt not found" }, 404);
  }

  return c.json({ prompt });
});

promptsRouter.post(
  "/:id/versions",
  zValidator("json", createVersionSchema, authValidationHook),
  async (c) => {
    const { id } = c.req.param();
    const input = c.req.valid("json");
    const user = c.get("adminUser");

    const prompt = await getPromptWithVersions(id);
    if (!prompt) {
      return c.json({ error: "prompt not found" }, 404);
    }

    const version = await addPromptVersion({
      promptId: id,
      content: input.content,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      notes: input.notes ?? null,
      userId: user.id,
    });

    return c.json({ version }, 201);
  },
);

promptsRouter.post(
  "/:id/active",
  zValidator("json", setActiveVersionSchema, authValidationHook),
  async (c) => {
    const { id } = c.req.param();
    const { versionId } = c.req.valid("json");

    const updated = await setActiveVersion(id, versionId);
    if (!updated) {
      return c.json({ error: "version not found for this prompt" }, 404);
    }

    return c.json({ prompt: updated });
  },
);
