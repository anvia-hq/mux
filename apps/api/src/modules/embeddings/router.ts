import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { openAIApiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";
import { UpstreamOpenAICompatibleError } from "../../providers/openai-compatible-error";
import { resolveEmbeddingAccessModelId } from "../../providers/registry";
import type { EmbeddingRequest } from "../../providers/types";
import { sanitizedRelayError } from "../chat/relay/errors";
import { ChatRequestBodyError, readChatRequestBody } from "../chat/relay/request-body";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { ApiKeyUnbillableEmbeddingUsageError, handleEmbedding } from "./services";
import { embeddingsRelayConfig } from "./relay/config";
import {
  EmbeddingsRelayClientAbortError,
  EmbeddingsRelayProtocolError,
  EmbeddingsRelayTimeoutError,
} from "./relay/errors";
import {
  checkEmbeddingsRateLimit,
  EmbeddingsRateLimitExceededError,
  EmbeddingsRateLimitUnavailableError,
  recordEmbeddingsRateLimitSuccess,
} from "./relay/rate-limit";

export const embeddingsRouter = new Hono();

embeddingsRouter.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId" as never, requestId);
  c.header("x-request-id", requestId);
  await next();
});
embeddingsRouter.use("*", openAIApiKeyAuth);

embeddingsRouter.post("/", enforceEmbeddingsRateLimit, async (c) => {
  const parsed = await parseEmbeddingBody(c);
  if (parsed instanceof Response) return parsed;
  const { body, rawBody } = parsed;

  try {
    const accessModelId = await resolveEmbeddingAccessModelId(body.model);
    assertApiKeyModelAllowed(accessModelId, readApiKeyModelAccess(c));
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json(
        embeddingErrorBody(c, error.message, "permission_error", "model_not_allowed"),
        403,
      );
    }
    throw error;
  }

  const apiKeyId = c.get("apiKeyId" as never) as string;
  const { limited, billing } = billingOptions(c);
  try {
    const result = await handleEmbedding(body, apiKeyId, {
      requireBillableUsage: limited,
      billing,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
      requestId: requestIdFromHono(c),
      signal: c.req.raw.signal,
    });
    copyUpstreamHeaders(c, result.headers);
    await safeRecordEmbeddingsSuccess(c);
    return c.json(result.response, result.status as 200);
  } catch (error) {
    return embeddingsErrorResponse(c, error);
  }
});

async function parseEmbeddingBody(
  c: Context,
): Promise<{ body: EmbeddingRequest; rawBody: string } | Response> {
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType && contentType !== "application/json" && !contentType.endsWith("+json")) {
    return c.json(
      embeddingErrorBody(
        c,
        "content type must be application/json",
        "invalid_request_error",
        "unsupported_media_type",
      ),
      415,
    );
  }

  let rawBody: string;
  let parsed: unknown;
  try {
    rawBody = await readChatRequestBody(c.req.raw, embeddingsRelayConfig.maxRequestBodyBytes);
    parsed = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof ChatRequestBodyError) {
      return c.json(
        embeddingErrorBody(c, error.message, "invalid_request_error", error.code),
        error.status,
      );
    }
    return c.json(
      embeddingErrorBody(c, "invalid JSON body", "invalid_request_error", "bad_request_body"),
      400,
    );
  }

  let forwardedBody = rawBody;
  const pathModel = c.req.param("model");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (!record.model && pathModel) {
      record.model = pathModel;
      forwardedBody = JSON.stringify(record);
    }
  }

  const validationError = validateEmbeddingRequestShape(parsed);
  if (validationError) {
    return c.json(
      embeddingErrorBody(
        c,
        validationError.message,
        "invalid_request_error",
        "invalid_value",
        validationError.param,
      ),
      400,
    );
  }
  return { body: parsed as EmbeddingRequest, rawBody: forwardedBody };
}

function billingOptions(c: Context) {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const legacy = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const own = c.get("apiKeyOwnSpendLimitUsd" as never) as number | null | undefined;
  const ownerId = c.get("apiKeyOwnerId" as never) as string | undefined;
  const ownerLimit = c.get("apiKeyOwnerSpendLimitUsd" as never) as number | null | undefined;
  const apiKeyLimit = own === undefined ? legacy : own;
  const limited = apiKeyLimit != null || ownerLimit != null;
  return {
    limited,
    billing: limited
      ? { apiKeyId, ownerId, apiKeyLimitUsd: apiKeyLimit, ownerLimitUsd: ownerLimit }
      : undefined,
  };
}

async function enforceEmbeddingsRateLimit(c: Context, next: () => Promise<void>) {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  try {
    await checkEmbeddingsRateLimit(apiKeyId, embeddingsRelayConfig);
  } catch (error) {
    if (error instanceof EmbeddingsRateLimitExceededError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json(
        embeddingErrorBody(c, error.message, "rate_limit_error", "rate_limit_exceeded"),
        429,
      );
    }
    if (error instanceof EmbeddingsRateLimitUnavailableError) {
      return c.json(
        embeddingErrorBody(c, error.message, "server_error", "service_unavailable"),
        503,
      );
    }
    throw error;
  }
  await next();
}

function embeddingsErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof UpstreamOpenAICompatibleError) {
    const sanitized = sanitizedRelayError(error, requestIdFromHono(c));
    if (sanitized.retryAfter) c.header("Retry-After", sanitized.retryAfter);
    return c.json(sanitized.body, sanitized.status as 400);
  }
  if (error instanceof EmbeddingsRelayClientAbortError) {
    return c.json(
      embeddingErrorBody(c, error.message, "request_aborted", "client_disconnected"),
      499 as 400,
    );
  }
  if (error instanceof EmbeddingsRelayTimeoutError) {
    return c.json(embeddingErrorBody(c, error.message, "timeout_error", "upstream_timeout"), 504);
  }
  if (error instanceof EmbeddingsRelayProtocolError || error instanceof TypeError) {
    return c.json(
      embeddingErrorBody(c, "Upstream request failed", "upstream_error", "upstream_request_failed"),
      502,
    );
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  if (message.startsWith("No provider found")) {
    return c.json(embeddingErrorBody(c, message, "not_found_error", "model_not_found"), 404);
  }
  if (
    error instanceof ApiKeySpendLimitExceededError ||
    error instanceof ApiKeyUnbillableEmbeddingUsageError
  ) {
    return c.json(embeddingErrorBody(c, message, "rate_limit_error", "spend_limit_exceeded"), 429);
  }
  if (error instanceof ApiKeyModelAccessDeniedError) {
    return c.json(embeddingErrorBody(c, message, "permission_error", "model_not_allowed"), 403);
  }
  if (error instanceof ChannelParamOverrideError) {
    return c.json(
      embeddingErrorBody(c, error.message, error.type, error.code),
      error.statusCode as 400,
    );
  }
  if (error instanceof ChannelHeaderOverrideError) {
    return c.json(
      embeddingErrorBody(c, error.message, "invalid_request_error", "invalid_request"),
      400,
    );
  }
  if (
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError ||
    error instanceof EmbeddingsRateLimitUnavailableError
  ) {
    return c.json(embeddingErrorBody(c, message, "server_error", "service_unavailable"), 503);
  }

  console.error("embeddings_request_failed", { requestId: requestIdFromHono(c), error: message });
  return c.json(
    embeddingErrorBody(c, "Internal server error", "server_error", "internal_error"),
    500,
  );
}

async function safeRecordEmbeddingsSuccess(c: Context) {
  try {
    await recordEmbeddingsRateLimitSuccess(
      c.get("apiKeyId" as never) as string,
      embeddingsRelayConfig,
    );
  } catch (error) {
    console.error("embeddings_rate_limit_success_record_failed", {
      requestId: requestIdFromHono(c),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function embeddingErrorBody(
  c: Context,
  message: string,
  type: string,
  code: string | null,
  param: string | null = null,
) {
  return {
    error: {
      message: `${message} (request_id: ${requestIdFromHono(c)})`,
      type,
      param,
      code,
    },
  };
}

function copyUpstreamHeaders(c: Context, headers: Headers) {
  const blocked = new Set([
    "connection",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "keep-alive",
    "trailer",
    "upgrade",
    "set-cookie",
    "x-request-id",
  ]);
  headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) c.header(key, value);
  });
}

function requestIdFromHono(c: Context): string {
  return c.get("requestId" as never) as string;
}

function validateEmbeddingRequestShape(
  value: unknown,
): { message: string; param: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { message: "request body must be an object", param: null };
  }

  const request = value as {
    model?: unknown;
    input?: unknown;
    encoding_format?: unknown;
    dimensions?: unknown;
    user?: unknown;
  };

  if (typeof request.model !== "string" || request.model.length === 0) {
    return { message: "request must include a model", param: "model" };
  }
  if (!("input" in request)) {
    return { message: "request must include input", param: "input" };
  }

  const inputError = validateEmbeddingInput(request.input);
  if (inputError) return { message: inputError, param: "input" };

  if (
    request.encoding_format !== undefined &&
    request.encoding_format !== "float" &&
    request.encoding_format !== "base64"
  ) {
    return { message: "encoding_format must be float or base64", param: "encoding_format" };
  }
  if (
    request.dimensions !== undefined &&
    (typeof request.dimensions !== "number" ||
      !Number.isInteger(request.dimensions) ||
      request.dimensions < 1)
  ) {
    return { message: "dimensions must be a positive integer", param: "dimensions" };
  }
  if (request.user !== undefined && typeof request.user !== "string") {
    return { message: "user must be a string", param: "user" };
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
  if (input.length === 0) return "input array must not be empty";
  if (input.every((item) => typeof item === "string")) {
    if (input.length > 2048) return "input string array must contain 2048 items or fewer";
    return input.some((item) => item.length === 0) ? "input strings must not be empty" : null;
  }
  if (input.every(isTokenId)) {
    return input.length > 2048 ? "token id array must contain 2048 items or fewer" : null;
  }
  if (input.every(Array.isArray)) {
    for (const [index, tokenIds] of input.entries()) {
      if (tokenIds.length === 0) return `input[${index}] token id array must not be empty`;
      if (tokenIds.length > 2048) {
        return `input[${index}] token id array must contain 2048 items or fewer`;
      }
      if (!tokenIds.every(isTokenId)) return `input[${index}] must contain only token ids`;
    }
    return null;
  }
  return "input array must contain only strings, token ids, or token id arrays";
}

function isTokenId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
