import { Elysia } from "elysia";
import { requireSession } from "../../middleware/auth-guard";
import { apiKeyIdParamSchema, createApiKeyBodySchema } from "./schema";
import type { ApiKeysRouterDeps } from "./types";

export const createApiKeysRouter = ({ sessionResolver, apiKeysService }: ApiKeysRouterDeps) =>
  new Elysia({ prefix: "/v1/api-keys" })
    .onTransform(async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
    })
    .get("/", async ({ request }) => {
      const user = await requireSession(sessionResolver, request.headers);
      const apiKeys = await apiKeysService.listForUser(user);

      return { apiKeys };
    })
    .post(
      "/",
      async ({ request, body, set }) => {
        const user = await requireSession(sessionResolver, request.headers);
        const created = await apiKeysService.create(user, body);

        set.status = 201;

        return created;
      },
      {
        body: createApiKeyBodySchema,
      },
    )
    .delete(
      "/:id",
      async ({ request, params }) => {
        const user = await requireSession(sessionResolver, request.headers);
        const apiKey = await apiKeysService.revoke(user, params.id);

        return { apiKey };
      },
      {
        params: apiKeyIdParamSchema,
      },
    );
