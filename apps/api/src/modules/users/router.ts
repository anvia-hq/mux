import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { requireRole } from "../auth/services";
import { promoteUserParamsSchema, usersQuerySchema } from "./schema";
import { listUsers, promoteUserToAdmin } from "./services";

export const usersRouter = new Hono()
  .get("/", zValidator("query", usersQuerySchema), async (c) => {
    const currentUser = await requireRole(c, "ADMIN");

    if (!currentUser) {
      return c.json({ error: "forbidden" }, 403);
    }

    const users = await listUsers();

    return c.json({ users });
  })
  .post("/:id/promote", zValidator("param", promoteUserParamsSchema), async (c) => {
    const currentUser = await requireRole(c, "ADMIN");

    if (!currentUser) {
      return c.json({ error: "forbidden" }, 403);
    }

    const user = await promoteUserToAdmin(c.req.valid("param").id);

    if (!user) {
      return c.json({ error: "user not found" }, 404);
    }

    return c.json({ user });
  });
