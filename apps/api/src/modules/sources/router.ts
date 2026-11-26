import { Elysia } from "elysia";
import { requireAdmin, requireSession } from "../../middleware/auth-guard";
import {
  createMcpSourceBodySchema,
  registerLocalPluginBodySchema,
  sourceIdParamSchema,
  updateSourceBodySchema,
  uploadPluginBodySchema,
} from "./schema";
import type { SourcesRouterDeps } from "./types";

export const createSourcesRouter = ({ sessionResolver, sourcesService }: SourcesRouterDeps) =>
  new Elysia({ prefix: "/v1/sources" })
    .onTransform(async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
    })
    .get("/", async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
      const sources = await sourcesService.list();

      return { sources };
    })
    .get("/plugins/local", async ({ request }) => {
      await requireAdmin(sessionResolver, request.headers);
      const plugins = await sourcesService.listLocalPlugins();

      return { plugins };
    })
    .get(
      "/:id",
      async ({ request, params }) => {
        await requireSession(sessionResolver, request.headers);
        const source = await sourcesService.getById(params.id);

        return { source };
      },
      {
        params: sourceIdParamSchema,
      },
    )
    .post(
      "/mcp",
      async ({ request, body, set }) => {
        const user = await requireAdmin(sessionResolver, request.headers);
        const result = await sourcesService.createMcpSource(user, body);

        set.status = 201;

        return result;
      },
      {
        body: createMcpSourceBodySchema,
      },
    )
    .post(
      "/plugins/local",
      async ({ request, body, set }) => {
        const user = await requireAdmin(sessionResolver, request.headers);
        const result = await sourcesService.registerLocalPlugin(user, body);

        set.status = 201;

        return result;
      },
      {
        body: registerLocalPluginBodySchema,
      },
    )
    .post(
      "/plugins/upload",
      async ({ request, body, set }) => {
        const user = await requireAdmin(sessionResolver, request.headers);
        const result = await sourcesService.uploadPlugin(user, body);

        set.status = 201;

        return result;
      },
      {
        body: uploadPluginBodySchema,
      },
    )
    .patch(
      "/:id",
      async ({ request, params, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const source = await sourcesService.update(params.id, body);

        return { source };
      },
      {
        params: sourceIdParamSchema,
        body: updateSourceBodySchema,
      },
    )
    .delete(
      "/:id",
      async ({ request, params, set }) => {
        await requireAdmin(sessionResolver, request.headers);
        await sourcesService.remove(params.id);
        set.status = 204;
      },
      {
        params: sourceIdParamSchema,
      },
    )
    .post(
      "/:id/sync",
      async ({ request, params }) => {
        await requireAdmin(sessionResolver, request.headers);

        return sourcesService.syncSource(params.id);
      },
      {
        params: sourceIdParamSchema,
      },
    );
