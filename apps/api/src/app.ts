import { cors } from "@elysiajs/cors";
import type { ToolCache } from "@mux/core/cache/types";
import { Elysia } from "elysia";
import type { SessionResolver } from "./auth";
import { createErrorPlugin, errorPlugin } from "./errors";
import { createApiKeysRouter } from "./modules/api-keys/router";
import type { ApiKeysService } from "./modules/api-keys/types";
import { createEndpointsRouter } from "./modules/endpoints/router";
import type { EndpointsService } from "./modules/endpoints/types";
import { createExecutionsRouter } from "./modules/executions/router";
import type { ToolExecutionService } from "./modules/executions/types";
import { createGatewayRouter } from "./modules/gateway/router";
import { createSourcesRouter } from "./modules/sources/router";
import type { SourcesService } from "./modules/sources/types";
import { createToolsRouter } from "./modules/tools/router";
import type { ToolsRepository, ToolsService } from "./modules/tools/types";
import { createUsersRouter } from "./modules/users/router";
import type { UsersService } from "./modules/users/types";

export interface AppDeps {
  corsOrigins: string[];
  authHandler: (request: Request) => Promise<Response> | Response;
  sessionResolver: SessionResolver;
  usersService: UsersService;
  apiKeysService: ApiKeysService;
  endpointsService: EndpointsService;
  sourcesService: SourcesService;
  toolsService: ToolsService;
  toolsRepo: Pick<ToolsRepository, "listCanonicalToolsForEndpoint">;
  toolCache: Pick<ToolCache, "getEndpointCatalog" | "setEndpointCatalog">;
  executionService: ToolExecutionService;
  onUnexpectedError?: (error: unknown) => void;
}

export const createApp = (deps: AppDeps) =>
  new Elysia({ name: "mux-api" })
    .use(
      cors({
        origin: deps.corsOrigins,
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      }),
    )
    .use(deps.onUnexpectedError ? createErrorPlugin(deps.onUnexpectedError) : errorPlugin)
    .get("/", () => ({ name: "mux-api" }))
    .get("/health", () => ({ ok: true }))
    .all("/api/auth/*", ({ request }) => deps.authHandler(request))
    .use(
      createUsersRouter({
        sessionResolver: deps.sessionResolver,
        usersService: deps.usersService,
      }),
    )
    .use(
      createApiKeysRouter({
        sessionResolver: deps.sessionResolver,
        apiKeysService: deps.apiKeysService,
      }),
    )
    .use(
      createEndpointsRouter({
        sessionResolver: deps.sessionResolver,
        endpointsService: deps.endpointsService,
      }),
    )
    .use(
      createSourcesRouter({
        sessionResolver: deps.sessionResolver,
        sourcesService: deps.sourcesService,
      }),
    )
    .use(
      createToolsRouter({
        sessionResolver: deps.sessionResolver,
        toolsService: deps.toolsService,
      }),
    )
    .use(
      createExecutionsRouter({
        sessionResolver: deps.sessionResolver,
        executionService: deps.executionService,
      }),
    )
    .use(
      createGatewayRouter({
        apiKeysService: deps.apiKeysService,
        endpointsService: deps.endpointsService,
        toolsRepo: deps.toolsRepo,
        toolCache: deps.toolCache,
        executionService: deps.executionService,
      }),
    );

export type App = ReturnType<typeof createApp>;
