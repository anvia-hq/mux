import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import type { SessionResolver } from "./auth";
import { errorPlugin } from "./errors";
import { createApiKeysRouter } from "./modules/api-keys/router";
import type { ApiKeysService } from "./modules/api-keys/types";
import { createEndpointsRouter } from "./modules/endpoints/router";
import type { EndpointsService } from "./modules/endpoints/types";
import { createUsersRouter } from "./modules/users/router";
import type { UsersService } from "./modules/users/types";

export interface AppDeps {
  corsOrigins: string[];
  authHandler: (request: Request) => Promise<Response> | Response;
  sessionResolver: SessionResolver;
  usersService: UsersService;
  apiKeysService: ApiKeysService;
  endpointsService: EndpointsService;
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
    .use(errorPlugin)
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
    );

export type App = ReturnType<typeof createApp>;
