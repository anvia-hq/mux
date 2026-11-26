import { Elysia } from "elysia";
import { requireSession } from "../../middleware/auth-guard";
import { executeToolBodySchema, executeToolParamSchema, listExecutionsQuerySchema } from "./schema";
import type { ExecutionsRouterDeps } from "./types";

export const createExecutionsRouter = ({
  sessionResolver,
  executionService,
}: ExecutionsRouterDeps) =>
  new Elysia()
    .onTransform(async ({ request }) => {
      await requireSession(sessionResolver, request.headers);
    })
    .get(
      "/v1/executions",
      async ({ request, query }) => {
        await requireSession(sessionResolver, request.headers);
        const executions = await executionService.listExecutions({
          toolId: query.toolId,
          endpointId: query.endpointId,
          limit: query.limit,
        });

        return { executions };
      },
      {
        query: listExecutionsQuerySchema,
      },
    )
    .post(
      "/v1/tools/:id/execute",
      async ({ request, params, body }) => {
        const user = await requireSession(sessionResolver, request.headers);

        return executionService.executeByToolId({
          toolId: params.id,
          args: body.arguments,
          bypassCache: body.bypassCache,
          userId: user.id,
        });
      },
      {
        params: executeToolParamSchema,
        body: executeToolBodySchema,
      },
    );
