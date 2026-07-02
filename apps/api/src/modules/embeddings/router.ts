import { Hono } from "hono";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import type { EmbeddingRequest } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { ApiKeyUnbillableEmbeddingUsageError, handleEmbedding } from "./services";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";

export const embeddingsRouter = new Hono();

embeddingsRouter.use("*", apiKeyAuth);

embeddingsRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: EmbeddingRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as EmbeddingRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const pathModel = c.req.param("model");
  if (!body.model && pathModel) {
    body.model = pathModel;
  }

  const validationError = validateEmbeddingRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  try {
    assertApiKeyModelAllowed(body.model, readApiKeyModelAccess(c));
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

    const response = await handleEmbedding(body, apiKeyId, {
      requireBillableUsage: isLimitedKey,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });
    return c.json(response);
  } catch (error) {
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

    if (error instanceof ApiKeyUnbillableEmbeddingUsageError) {
      return c.json({ error: errorMessage }, 429);
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

function validateEmbeddingRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";

  const request = value as {
    model?: unknown;
    input?: unknown;
    encoding_format?: unknown;
    dimensions?: unknown;
    user?: unknown;
  };

  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (!("input" in request)) {
    return "request must include input";
  }

  const inputError = validateEmbeddingInput(request.input);
  if (inputError) return inputError;

  if (
    request.encoding_format !== undefined &&
    request.encoding_format !== "float" &&
    request.encoding_format !== "base64"
  ) {
    return "encoding_format must be float or base64";
  }

  if (
    request.dimensions !== undefined &&
    (typeof request.dimensions !== "number" ||
      !Number.isInteger(request.dimensions) ||
      request.dimensions < 1)
  ) {
    return "dimensions must be a positive integer";
  }

  if (request.user !== undefined && typeof request.user !== "string") {
    return "user must be a string";
  }

  return null;
}

function validateEmbeddingInput(input: unknown): string | null {
  if (typeof input === "string") {
    return input.length === 0 ? "input string must not be empty" : null;
  }

  if (!Array.isArray(input)) {
    return "input must be a string, array of strings, array of token ids, or array of token id arrays";
  }

  if (input.length === 0) {
    return "input array must not be empty";
  }

  if (input.every((item) => typeof item === "string")) {
    if (input.length > 2048) {
      return "input string array must contain 2048 items or fewer";
    }
    return input.some((item) => item.length === 0) ? "input strings must not be empty" : null;
  }

  if (input.every(isTokenId)) {
    return input.length > 2048 ? "token id array must contain 2048 items or fewer" : null;
  }

  if (input.every(Array.isArray)) {
    for (const [index, tokenIds] of input.entries()) {
      if (tokenIds.length === 0) {
        return `input[${index}] token id array must not be empty`;
      }
      if (tokenIds.length > 2048) {
        return `input[${index}] token id array must contain 2048 items or fewer`;
      }
      if (!tokenIds.every(isTokenId)) {
        return `input[${index}] must contain only token ids`;
      }
    }
    return null;
  }

  return "input array must contain only strings, token ids, or token id arrays";
}

function isTokenId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
