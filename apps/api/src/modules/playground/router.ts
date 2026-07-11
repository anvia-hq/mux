import { createCompletionStream } from "@anvia/core";
import type { Message } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createEventStream } from "@anvia/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createPlaygroundApiKeyToken } from "../../middleware/api-key";
import type { User } from "../../utils/prisma";
import {
  ApiKeyModelAccessDeniedError,
  assertApiKeyModelAllowed,
  getActiveApiKeyForAuth,
} from "../keys/services";
import { getCurrentUser } from "../auth/services";
import { authValidationHook } from "../auth/utils";

const playgroundChatSchema = z.object({
  apiKeyId: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  stream: z.literal(true),
});

type PlaygroundRouterEnv = {
  Variables: {
    user: User;
  };
};

export const playgroundRouter = new Hono<PlaygroundRouterEnv>();

playgroundRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
});

playgroundRouter.post(
  "/chat/completions",
  zValidator("json", playgroundChatSchema, authValidationHook),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const apiKey = await getActiveApiKeyForAuth(body.apiKeyId);

    if (!apiKey || apiKey.createdBy !== user.id) {
      return c.json({ error: "API key not found or revoked" }, 404);
    }

    try {
      assertApiKeyModelAllowed(body.model, apiKey);
    } catch (error) {
      if (error instanceof ApiKeyModelAccessDeniedError) {
        return c.json({ error: error.message }, 403);
      }
      throw error;
    }

    const token = await createPlaygroundApiKeyToken(apiKey.id);
    const client = new OpenAIClient({
      apiKey: token,
      baseUrl: playgroundOpenAIBaseUrl(),
      completionApi: "chat",
    });

    return createEventStream(
      createCompletionStream(client.completionModel(body.model), {
        messages: body.messages as Message[],
      }),
      { format: "jsonl" },
    );
  },
);

function playgroundOpenAIBaseUrl(): string {
  const configured = process.env.PLAYGROUND_OPENAI_BASE_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  const port = Number(process.env.API_PORT ?? 8000);
  return `http://127.0.0.1:${port}/v1`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
