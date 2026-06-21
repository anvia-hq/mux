import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./modules/auth/router";
import { chatRouter } from "./modules/chat/router";
import { keysRouter } from "./modules/keys/router";
import { logsRouter } from "./modules/logs/router";
import { modelsDashboardRouter, modelsRouter } from "./modules/models/router";
import { providersRouter } from "./modules/providers/router";
import { usersRouter } from "./modules/users/router";
import { initProviders } from "./providers/registry";

// Initialize LLM provider adapters on startup. Reads keys from the DB
// (set via the dashboard), falling back to env vars for first boot.
await initProviders();

const clientOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono()
  .use(
    "*",
    cors({
      origin: (origin) => (clientOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  )
  .get("/health", (c) => {
    return c.json({ ok: true, service: "mux-gateway" });
  })
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/v1/chat", chatRouter)
  .route("/v1/models", modelsRouter)
  .route("/dashboard/models", modelsDashboardRouter)
  .route("/api-keys", keysRouter)
  .route("/logs", logsRouter)
  .route("/providers", providersRouter);

const port = Number(process.env.API_PORT ?? 8000);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Mux Gateway listening on http://localhost:${info.port}`);
  },
);
