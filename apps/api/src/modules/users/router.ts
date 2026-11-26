import { Elysia } from "elysia";
import { requireAdmin, requireSession } from "../../middleware/auth-guard";
import { updateUserRoleBodySchema, userIdParamSchema } from "./schema";
import type { UsersRouterDeps } from "./types";

export const createUsersRouter = ({ sessionResolver, usersService }: UsersRouterDeps) =>
  new Elysia({ prefix: "/v1/users" })
    .onTransform(async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
    })
    .get("/me", async ({ request }) => {
      const user = await requireSession(sessionResolver, request.headers);

      return { user };
    })
    .get("/", async ({ request }) => {
      await requireAdmin(sessionResolver, request.headers);
      const users = await usersService.listUsers();

      return { users };
    })
    .patch(
      "/:id/role",
      async ({ request, params, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const user = await usersService.updateUserRole(params.id, body.role);

        return { user };
      },
      {
        params: userIdParamSchema,
        body: updateUserRoleBodySchema,
      },
    );
