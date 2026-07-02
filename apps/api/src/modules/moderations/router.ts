import { Hono } from "hono";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleErrorResponse } from "../../providers/openai-compatible-error";
import type { ModerationRequest } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { handleModeration } from "./services";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";

const DEFAULT_MODERATION_MODEL = "openai:text-moderation-latest";

export const moderationsRouter = new Hono();

moderationsRouter.use("*", apiKeyAuth);

moderationsRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: ModerationRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as ModerationRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  body.model = body.model || DEFAULT_MODERATION_MODEL;

  const validationError = validateModerationRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const request = body as ModerationRequest & { model: string };

  try {
    assertApiKeyModelAllowed(request.model, readApiKeyModelAccess(c));
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const response = await handleModeration(request, apiKeyId, {
      recordSpend: isLimitedKey,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });
    return c.json(response);
  } catch (error) {
    const upstream = upstreamOpenAICompatibleErrorResponse(error);
    if (upstream) return upstream;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.startsWith("No provider found")) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof ApiKeySpendLimitExceededError) {
      return c.json({ error: errorMessage }, 429);
    }

    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: errorMessage }, 403);
    }

    if (error instanceof ChannelParamOverrideError) {
      return c.json(
        { error: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
      );
    }

    if (error instanceof ChannelHeaderOverrideError) {
      return c.json({ error: error.message }, 400);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

function validateModerationRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";

  const request = value as { model?: unknown; input?: unknown };

  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (!("input" in request)) {
    return "request must include input";
  }

  return validateModerationInput(request.input);
}

function validateModerationInput(input: unknown): string | null {
  if (typeof input === "string") {
    return input.length === 0 ? "input string must not be empty" : null;
  }

  if (!Array.isArray(input)) {
    return "input must be a string, array of strings, or array of moderation content parts";
  }

  if (input.length === 0) {
    return "input array must not be empty";
  }

  if (input.every((item) => typeof item === "string")) {
    return input.some((item) => item.length === 0) ? "input strings must not be empty" : null;
  }

  if (input.every(isModerationContentPart)) {
    return null;
  }

  return "input array must contain only strings or moderation content parts";
}

function isModerationContentPart(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;

  const part = value as { type?: unknown; text?: unknown; image_url?: unknown };
  if (part.type === "text") {
    return typeof part.text === "string" && part.text.length > 0;
  }

  if (part.type !== "image_url" || !part.image_url || typeof part.image_url !== "object") {
    return false;
  }

  const imageUrl = part.image_url as { url?: unknown };
  return typeof imageUrl.url === "string" && imageUrl.url.length > 0;
}
