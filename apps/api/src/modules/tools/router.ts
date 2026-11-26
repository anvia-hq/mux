import { Elysia } from "elysia";
import { requireAdmin, requireSession } from "../../middleware/auth-guard";
import {
  invalidateTagBodySchema,
  listToolsQuerySchema,
  toolIdParamSchema,
  updateToolBodySchema,
} from "./schema";
import type { ToolsRouterDeps } from "./types";

export const createToolsRouter = ({ sessionResolver, toolsService }: ToolsRouterDeps) =>
  new Elysia({ prefix: "/v1/tools" })
    .onTransform(async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
    })
    .get(
      "/",
      async ({ request, query }) => {
        await requireSession(sessionResolver, request.headers);
        const tools = await toolsService.list(query.sourceId);

        return { tools };
      },
      {
        query: listToolsQuerySchema,
      },
    )
    .get(
      "/:id",
      async ({ request, params }) => {
        await requireSession(sessionResolver, request.headers);
        const tool = await toolsService.getById(params.id);

        return { tool };
      },
      {
        params: toolIdParamSchema,
      },
    )
    .patch(
      "/:id",
      async ({ request, params, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const tool = await toolsService.update(params.id, body);

        return { tool };
      },
      {
        params: toolIdParamSchema,
        body: updateToolBodySchema,
      },
    )
    .post(
      "/:id/cache/invalidate",
      async ({ request, params }) => {
        await requireAdmin(sessionResolver, request.headers);
        const deleted = await toolsService.invalidateToolCache(params.id);

        return { deleted };
      },
      {
        params: toolIdParamSchema,
      },
    )
    .post(
      "/cache/invalidate-tag",
      async ({ request, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const deleted = await toolsService.invalidateTagCache(body.tag);

        return { deleted };
      },
      {
        body: invalidateTagBodySchema,
      },
    );
