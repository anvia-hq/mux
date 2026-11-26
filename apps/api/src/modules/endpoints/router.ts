import { Elysia } from "elysia";
import { requireAdmin, requireSession } from "../../middleware/auth-guard";
import {
  createEndpointBodySchema,
  endpointIdParamSchema,
  endpointToolParamsSchema,
  updateEndpointBodySchema,
  upsertEndpointToolBodySchema,
} from "./schema";
import type { EndpointsRouterDeps } from "./types";

export const createEndpointsRouter = ({ sessionResolver, endpointsService }: EndpointsRouterDeps) =>
  new Elysia({ prefix: "/v1/endpoints" })
    .get("/", async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
      const endpoints = await endpointsService.list();

      return { endpoints };
    })
    .get(
      "/:id",
      async ({ request, params }) => {
        await requireSession(sessionResolver, request.headers);
        const endpoint = await endpointsService.getById(params.id);

        return { endpoint };
      },
      {
        params: endpointIdParamSchema,
      },
    )
    .post(
      "/",
      async ({ request, body, set }) => {
        const user = await requireAdmin(sessionResolver, request.headers);
        const endpoint = await endpointsService.create(user, body);

        set.status = 201;

        return { endpoint };
      },
      {
        body: createEndpointBodySchema,
      },
    )
    .patch(
      "/:id",
      async ({ request, params, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const endpoint = await endpointsService.update(params.id, body);

        return { endpoint };
      },
      {
        params: endpointIdParamSchema,
        body: updateEndpointBodySchema,
      },
    )
    .delete(
      "/:id",
      async ({ request, params, set }) => {
        await requireAdmin(sessionResolver, request.headers);
        await endpointsService.remove(params.id);
        set.status = 204;
      },
      {
        params: endpointIdParamSchema,
      },
    )
    .get(
      "/:id/tools",
      async ({ request, params }) => {
        await requireSession(sessionResolver, request.headers);
        const tools = await endpointsService.listTools(params.id);

        return { tools };
      },
      {
        params: endpointIdParamSchema,
      },
    )
    .put(
      "/:id/tools/:toolId",
      async ({ request, params, body }) => {
        await requireAdmin(sessionResolver, request.headers);
        const endpointTool = await endpointsService.upsertTool(params.id, params.toolId, body);

        return { endpointTool };
      },
      {
        params: endpointToolParamsSchema,
        body: upsertEndpointToolBodySchema,
      },
    )
    .delete(
      "/:id/tools/:toolId",
      async ({ request, params, set }) => {
        await requireAdmin(sessionResolver, request.headers);
        await endpointsService.detachTool(params.id, params.toolId);
        set.status = 204;
      },
      {
        params: endpointToolParamsSchema,
      },
    );
