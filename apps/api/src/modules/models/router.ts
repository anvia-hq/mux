import { type Context, Hono, type Next } from "hono";
import { apiKeyAuth } from "../../middleware/api-key";
import { listAllModels } from "../../providers/registry";
import { getCurrentUser } from "../auth/services";
import { prisma } from "../../utils/prisma";

/**
 * Formats a provider model into the OpenAI `GET /v1/models` response shape.
 */
function toOpenAIModel(model: ReturnType<typeof listAllModels>[number]) {
  return {
    id: model.id,
    object: "model",
    created: Date.now(),
    owned_by: model.provider,
  };
}

/**
 * Router exposing the OpenAI-compatible `/v1/models` endpoint.
 *
 * All routes require a valid API key (validated by the apiKeyAuth middleware).
 * The single GET / handler returns the union of models exposed by every
 * initialized provider, formatted to match OpenAI's `GET /v1/models` response
 * shape so existing OpenAI SDK clients can consume it without modification.
 */
export const modelsRouter = new Hono();

modelsRouter.use("*", apiKeyAuth);

modelsRouter.get("/", (c) => {
  try {
    const models = listAllModels();
    return c.json({ object: "list", data: models.map(toOpenAIModel) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * Router exposing the same model catalog for the dashboard UI.
 *
 * Mounted at `/dashboard/models`. Authentication is the dashboard session
 * cookie (any logged-in user), not an API key, so the UI can render the
 * catalog without having to mint a dummy bearer token.
 */
export const modelsDashboardRouter = new Hono();

async function requireUser(c: Context, next: Next) {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}

modelsDashboardRouter.use("*", requireUser);

modelsDashboardRouter.get("/", async (c) => {
  try {
    const models = listAllModels();
    const disabled = new Set(
      (await prisma.disabledModel.findMany({ select: { modelId: true, provider: true } })).map(
        (r) => `${r.provider}:${r.modelId}`,
      ),
    );
    return c.json({ data: models.filter((m) => !disabled.has(`${m.provider}:${m.id}`)) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: errorMessage }, 500);
  }
});
