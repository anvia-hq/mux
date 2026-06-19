import { Hono } from "hono";
import { apiKeyAuth } from "../../middleware/api-key";
import { listAllModels } from "../../providers/registry";

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

    return c.json({
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: Date.now(),
        owned_by: model.provider,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: errorMessage }, 500);
  }
});
