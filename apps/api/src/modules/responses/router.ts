import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import type { ZodType } from "zod";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { UpstreamOpenAICompatibleError } from "../../providers/openai-compatible-error";
import {
  responseCompactRequestSchema,
  responseCreateRequestSchema,
} from "../../providers/responses-schema";
import { parseResponseStreamBlock, SseBlockParser } from "../../providers/responses-stream";
import type { ResponseCreateRequest, ResponseObject, ResponseUsage } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
} from "../keys/services";
import {
  ApiKeyUnbillableResponseUsageError,
  handleResponseCancel,
  handleResponseCompact,
  handleResponseCreate,
  handleResponseCreateStream,
  handleResponseDelete,
  handleResponseInputItems,
  handleResponseInputTokens,
  handleResponseRetrieve,
  OpenAIResponseProviderNotConfiguredError,
  readReasoningTokens,
  ResponseNotFoundError,
  submitBackgroundResponse,
  UnsupportedResponseFeatureError,
} from "./services";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";
import { ChatRequestBodyError, readChatRequestBody } from "../chat/relay/request-body";
import { sanitizedRelayError } from "../chat/relay/errors";
import { responsesRelayConfig } from "./relay/config";
import {
  ResponsesRelayClientAbortError,
  ResponsesRelayProtocolError,
  ResponsesRelayTimeoutError,
} from "./relay/errors";
import {
  checkResponsesRateLimit,
  recordResponsesRateLimitSuccess,
  ResponsesRateLimitExceededError,
  ResponsesRateLimitUnavailableError,
} from "./relay/rate-limit";
import { estimateResponseStreamPayloadTokens } from "./relay/token-estimator";

export const responsesRouter = new Hono();

responsesRouter.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId" as never, requestId);
  c.header("x-request-id", requestId);
  await next();
});
responsesRouter.use("*", apiKeyAuth);

function upstreamErrorResponse(c: Context, error: unknown): Response | null {
  if (error instanceof UpstreamOpenAICompatibleError) {
    const requestId = c.get("requestId" as never) as string;
    const sanitized = sanitizedRelayError(error, requestId);
    if (sanitized.retryAfter) c.header("Retry-After", sanitized.retryAfter);
    return c.json(
      sanitized.body,
      sanitized.status as 400 | 401 | 403 | 404 | 408 | 409 | 425 | 429 | 500 | 502 | 503 | 504,
    );
  }
  return null;
}

function relayErrorResponse(c: Context, error: unknown): Response | null {
  const requestId = c.get("requestId" as never) as string;
  if (error instanceof ResponsesRelayClientAbortError) {
    return new Response(
      JSON.stringify(
        openAIError(
          `${error.message} (request_id: ${requestId})`,
          "client_disconnected",
          "request_aborted",
        ),
      ),
      { status: 499, headers: { "Content-Type": "application/json" } },
    );
  }
  if (error instanceof ResponsesRelayTimeoutError) {
    return c.json(
      openAIError(
        `${error.message} (request_id: ${requestId})`,
        "upstream_timeout",
        "timeout_error",
      ),
      504,
    );
  }
  if (error instanceof ResponsesRelayProtocolError || error instanceof TypeError) {
    return c.json(
      openAIError(
        `Upstream request failed (request_id: ${requestId})`,
        "upstream_request_failed",
        "upstream_error",
      ),
      502,
    );
  }
  return null;
}

function channelOverrideErrorResponse(c: Context, error: unknown): Response | null {
  if (error instanceof ChannelParamOverrideError) {
    return c.json(
      {
        error: {
          message: error.message,
          type: error.type,
          code: error.code,
        },
      },
      error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    );
  }
  if (error instanceof ChannelHeaderOverrideError) {
    return c.json(
      {
        error: {
          message: error.message,
          type: "invalid_request_error",
          code: "invalid_request",
        },
      },
      400,
    );
  }
  return null;
}

function collectQueryParams(c: Context): Record<string, string | string[]> | undefined {
  const url = new URL(c.req.url);
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    result[key] = values.length > 1 ? values : (values[0] ?? "");
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function requestContextFromHono(c: Context) {
  return {
    clientHeaders: c.req.raw.headers,
    requestPath: new URL(c.req.url).pathname,
  };
}

function openAIError(message: string, code = "invalid_request", type = "invalid_request_error") {
  return { error: { message, type, param: null, code } };
}

function internalErrorResponse(c: Context, error: unknown): Response {
  const requestId = c.get("requestId" as never) as string;
  console.error("responses_request_failed", {
    requestId,
    error: error instanceof Error ? error.message : String(error),
  });
  return c.json(
    openAIError(
      `Internal server error (request_id: ${requestId})`,
      "internal_error",
      "server_error",
    ),
    500,
  );
}

function validatedJsonBody(schema: ZodType) {
  return async (c: Context, next: () => Promise<void>) => {
    const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && contentType !== "application/json" && !contentType.endsWith("+json")) {
      return c.json(
        openAIError("content type must be application/json", "unsupported_media_type"),
        415,
      );
    }
    let raw: string;
    let parsed: unknown;
    try {
      raw = await readChatRequestBody(c.req.raw, responsesRelayConfig.maxRequestBodyBytes);
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof ChatRequestBodyError) {
        return c.json(openAIError(error.message, error.code), error.status);
      }
      return c.json(openAIError("invalid JSON body", "bad_request_body"), 400);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      return c.json(
        {
          error: {
            message: issue?.message ?? "invalid request body",
            type: "invalid_request_error",
            param: issue?.path?.length ? issue.path.join(".") : null,
            code:
              issue?.code === "too_big" || issue?.code === "too_small"
                ? "out_of_range"
                : "invalid_value",
          },
        },
        400,
      );
    }
    c.set("rawJsonBody" as never, raw);
    c.set("validatedResponseBody" as never, result.data);
    await next();
  };
}

function rawJsonBodyFromHono(c: Context): string | undefined {
  return c.get("rawJsonBody" as never) as string | undefined;
}

function validatedResponseBody(c: Context): ResponseCreateRequest {
  return c.get("validatedResponseBody" as never) as ResponseCreateRequest;
}

async function enforceResponsesRateLimit(c: Context, next: () => Promise<void>) {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  try {
    await checkResponsesRateLimit(apiKeyId, responsesRelayConfig);
  } catch (error) {
    if (error instanceof ResponsesRateLimitExceededError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json(openAIError(error.message, "rate_limit_exceeded", "rate_limit_error"), 429);
    }
    if (error instanceof ResponsesRateLimitUnavailableError) {
      return c.json(openAIError(error.message, "service_unavailable", "server_error"), 503);
    }
    throw error;
  }
  await next();
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

async function safeRecordResponsesSuccess(c: Context) {
  try {
    await recordResponsesRateLimitSuccess(
      c.get("apiKeyId" as never) as string,
      responsesRelayConfig,
    );
  } catch (error) {
    console.error("responses_rate_limit_success_record_failed", {
      requestId: c.get("requestId" as never),
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

function isPendingResponse(response: ResponseObject): boolean {
  return Boolean((response as ResponseObject & { _pending?: boolean })._pending);
}

function disallowedModelResponse(c: Context, modelId: string): Response | null {
  try {
    assertApiKeyModelAllowed(modelId, readApiKeyModelAccess(c));
    return null;
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }
}

responsesRouter.post(
  "/",
  enforceResponsesRateLimit,
  validatedJsonBody(responseCreateRequestSchema),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const { limited: isLimitedKey, billing } = billingOptions(c);

    const body = validatedResponseBody(c);
    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;

    if (body.background === true) {
      try {
        const submitted = await submitBackgroundResponse(body, apiKeyId, {
          requireBillableUsage: isLimitedKey,
          billing,
          requestContext: requestContextFromHono(c),
          rawBody: rawJsonBodyFromHono(c),
          requestId: c.get("requestId" as never) as string,
          signal: c.req.raw.signal,
        });
        c.header("Location", `/v1/responses/${submitted.id}`);
        await safeRecordResponsesSuccess(c);
        return c.json(submitted.response, 202);
      } catch (error) {
        const upstream = upstreamErrorResponse(c, error);
        if (upstream) return upstream;
        const relay = relayErrorResponse(c, error);
        if (relay) return relay;
        const channelOverride = channelOverrideErrorResponse(c, error);
        if (channelOverride) return channelOverride;

        const errorMessage = error instanceof Error ? error.message : "Internal server error";

        if (errorMessage.startsWith("No provider found")) {
          return c.json({ error: errorMessage }, 404);
        }

        if (error instanceof UnsupportedResponseFeatureError) {
          return c.json({ error: errorMessage }, 422);
        }

        if (error instanceof ApiKeySpendLimitExceededError) {
          return c.json({ error: errorMessage }, 429);
        }

        if (error instanceof ApiKeyModelAccessDeniedError) {
          return c.json({ error: errorMessage }, 403);
        }

        if (error instanceof ApiKeyUnbillableResponseUsageError) {
          return c.json({ error: errorMessage }, 429);
        }

        if (
          error instanceof RequestLoggingUnavailableError ||
          error instanceof ApiKeySpendLedgerUnavailableError
        ) {
          return c.json({ error: errorMessage }, 503);
        }

        return internalErrorResponse(c, error);
      }
    }

    try {
      if (body.stream === true) {
        const result = await handleResponseCreateStream(body, apiKeyId, {
          requireBillableUsage: isLimitedKey,
          billing,
          requestContext: requestContextFromHono(c),
          rawBody: rawJsonBodyFromHono(c),
          requestId: c.get("requestId" as never) as string,
          signal: c.req.raw.signal,
        });
        const {
          stream: streamIterable,
          provider,
          model,
          channelId,
          channelName,
          latencyMs,
          abort,
          finalizeSpend,
        } = result;
        let logId: string;
        try {
          logId = await logStreamStart({
            apiKeyId,
            provider,
            model,
            requestedModel: body.model,
            channelId,
            channelName,
            endpoint: "/v1/responses",
            latencyMs: 0,
            statusCode: 102,
            errorMessage: "stream pending",
          });
        } catch (error) {
          abort();
          try {
            await finalizeSpend();
          } catch (settlementError) {
            console.error("responses_spend_settlement_failed", {
              requestId: c.get("requestId" as never),
              error:
                settlementError instanceof Error
                  ? settlementError.message
                  : String(settlementError),
            });
          }
          throw error;
        }

        copyUpstreamHeaders(c, result.headers);
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        return honoStream(c, async (streamWriter) => {
          const blockParser = new SseBlockParser();
          let usage: ResponseUsage | undefined;
          let outputTokenEstimate = 0;
          let terminal = false;
          let terminalError: string | undefined;
          let finalized = false;

          const finalize = async (statusCode: number, errorMessage?: string) => {
            if (finalized) return;
            finalized = true;
            let estimatedCost: number | undefined;
            try {
              estimatedCost = await finalizeSpend(usage, outputTokenEstimate);
            } catch (error) {
              console.error("responses_spend_settlement_failed", {
                requestId: c.get("requestId" as never),
                error: error instanceof Error ? error.message : String(error),
              });
            }
            try {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                requestedModel: body.model,
                channelId,
                channelName,
                endpoint: "/v1/responses",
                latencyMs,
                promptTokens: usage?.input_tokens,
                completionTokens: usage?.output_tokens,
                totalTokens: usage?.total_tokens,
                reasoningTokens: readReasoningTokens(usage),
                estimatedCost,
                statusCode,
                errorMessage,
              });
            } catch (logError) {
              console.error("Failed to finalize response stream log:", logError);
            }
          };

          streamWriter.onAbort(async () => {
            abort();
            await finalize(499, "client disconnected");
          });

          try {
            for await (const chunk of streamIterable) {
              await streamWriter.write(chunk);
              for (const block of blockParser.push(chunk)) {
                const event = parseResponseStreamBlock(block);
                if (event) outputTokenEstimate += estimateResponseStreamPayloadTokens(event);
                if (event?.type === "response.completed" || event?.type === "response.incomplete") {
                  terminal = true;
                  usage = event.response.usage;
                } else if (event?.type === "response.error") {
                  terminal = true;
                  terminalError = event.message;
                }
              }
            }
            for (const block of blockParser.end()) {
              const event = parseResponseStreamBlock(block);
              if (event) outputTokenEstimate += estimateResponseStreamPayloadTokens(event);
              if (event?.type === "response.completed" || event?.type === "response.incomplete") {
                terminal = true;
                usage = event.response.usage;
              } else if (event?.type === "response.error") {
                terminal = true;
                terminalError = event.message;
              }
            }
            if (!terminal) {
              throw new ResponsesRelayProtocolError(
                "Upstream stream ended without a terminal response event",
              );
            }
            await finalize(terminalError ? 502 : result.status, terminalError);
            if (!terminalError) await safeRecordResponsesSuccess(c);
          } catch (streamError) {
            const errorMessage =
              streamError instanceof Error ? streamError.message : "Unknown error";

            await finalize(502, errorMessage);
            try {
              await streamWriter.write(
                `event: error\ndata: ${JSON.stringify(
                  openAIError(
                    "Upstream stream failed",
                    "upstream_request_failed",
                    "upstream_error",
                  ),
                )}\n\n`,
              );
            } catch {
              // The downstream may already be gone.
            }
          }
        });
      }

      const result = await handleResponseCreate(body, apiKeyId, {
        requireBillableUsage: isLimitedKey,
        billing,
        requestContext: requestContextFromHono(c),
        rawBody: rawJsonBodyFromHono(c),
        requestId: c.get("requestId" as never) as string,
        signal: c.req.raw.signal,
      });
      copyUpstreamHeaders(c, result.headers);
      await safeRecordResponsesSuccess(c);
      return c.json(result.response, result.status as 200);
    } catch (error) {
      const upstream = upstreamErrorResponse(c, error);
      if (upstream) return upstream;
      const relay = relayErrorResponse(c, error);
      if (relay) return relay;
      const channelOverride = channelOverrideErrorResponse(c, error);
      if (channelOverride) return channelOverride;

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

      if (error instanceof ApiKeyUnbillableResponseUsageError) {
        return c.json({ error: errorMessage }, 429);
      }

      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        return c.json({ error: errorMessage }, 503);
      }

      if (error instanceof UnsupportedResponseFeatureError) {
        return c.json({ error: errorMessage }, 422);
      }

      return internalErrorResponse(c, error);
    }
  },
);

responsesRouter.post(
  "/compact",
  enforceResponsesRateLimit,
  validatedJsonBody(responseCompactRequestSchema),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const { limited: isLimitedKey, billing } = billingOptions(c);
    const body = validatedResponseBody(c);
    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;

    try {
      const result = await handleResponseCompact(body, apiKeyId, {
        requireBillableUsage: isLimitedKey,
        billing,
        requestContext: requestContextFromHono(c),
        rawBody: rawJsonBodyFromHono(c),
        requestId: c.get("requestId" as never) as string,
        signal: c.req.raw.signal,
      });
      await safeRecordResponsesSuccess(c);
      copyUpstreamHeaders(c, result.headers);
      return c.json(result.response, result.status as 200);
    } catch (error) {
      const upstream = upstreamErrorResponse(c, error);
      if (upstream) return upstream;
      const relay = relayErrorResponse(c, error);
      if (relay) return relay;
      const channelOverride = channelOverrideErrorResponse(c, error);
      if (channelOverride) return channelOverride;

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

      if (error instanceof ApiKeyUnbillableResponseUsageError) {
        return c.json({ error: errorMessage }, 429);
      }

      if (error instanceof ResponseNotFoundError) {
        return c.json({ error: errorMessage }, 404);
      }

      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        return c.json({ error: errorMessage }, 503);
      }

      if (error instanceof UnsupportedResponseFeatureError) {
        return c.json({ error: errorMessage }, 422);
      }

      return internalErrorResponse(c, error);
    }
  },
);

responsesRouter.post(
  "/input_tokens",
  enforceResponsesRateLimit,
  validatedJsonBody(responseCreateRequestSchema),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const rawBody = rawJsonBodyFromHono(c);
    const body = validatedResponseBody(c);

    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;

    try {
      const result = await handleResponseInputTokens(body, apiKeyId, {
        requestContext: {
          clientHeaders: c.req.raw.headers,
          requestPath: new URL(c.req.url).pathname,
        },
        rawBody,
        requestId: c.get("requestId" as never) as string,
        signal: c.req.raw.signal,
      });
      await safeRecordResponsesSuccess(c);
      copyUpstreamHeaders(c, result.headers);
      return c.json(result.response, result.status as 200);
    } catch (error) {
      const upstream = upstreamErrorResponse(c, error);
      if (upstream) return upstream;
      const relay = relayErrorResponse(c, error);
      if (relay) return relay;
      const channelOverride = channelOverrideErrorResponse(c, error);
      if (channelOverride) return channelOverride;

      const errorMessage = error instanceof Error ? error.message : "Internal server error";

      if (errorMessage.startsWith("No provider found")) {
        return c.json({ error: errorMessage }, 404);
      }

      if (error instanceof ResponseNotFoundError) {
        return c.json({ error: errorMessage }, 404);
      }

      if (error instanceof OpenAIResponseProviderNotConfiguredError) {
        return c.json({ error: errorMessage }, 503);
      }

      if (error instanceof UnsupportedResponseFeatureError) {
        return c.json({ error: errorMessage }, 422);
      }

      if (error instanceof RequestLoggingUnavailableError) {
        return c.json({ error: errorMessage }, 503);
      }

      return internalErrorResponse(c, error);
    }
  },
);

responsesRouter.get("/:id", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");
  const query = collectQueryParams(c);

  try {
    const response = await handleResponseRetrieve(id, apiKeyId, query);
    if (isPendingResponse(response)) {
      c.header("Location", `/v1/responses/${id}`);
      const { _pending, ...body } = response as ResponseObject & { _pending?: boolean };
      return c.json(body, 202);
    }
    return c.json(response);
  } catch (error) {
    const upstream = upstreamErrorResponse(c, error);
    if (upstream) return upstream;
    const relay = relayErrorResponse(c, error);
    if (relay) return relay;
    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof ResponseNotFoundError) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    return internalErrorResponse(c, error);
  }
});

responsesRouter.delete("/:id", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");

  try {
    const response = await handleResponseDelete(id, apiKeyId);
    return c.json(response);
  } catch (error) {
    const upstream = upstreamErrorResponse(c, error);
    if (upstream) return upstream;
    const relay = relayErrorResponse(c, error);
    if (relay) return relay;
    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof ResponseNotFoundError) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    return internalErrorResponse(c, error);
  }
});

responsesRouter.post("/:id/cancel", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");

  try {
    const result = await handleResponseCancel(id, apiKeyId);
    return c.json(result.response);
  } catch (error) {
    const upstream = upstreamErrorResponse(c, error);
    if (upstream) return upstream;
    const relay = relayErrorResponse(c, error);
    if (relay) return relay;
    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof ResponseNotFoundError) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    return internalErrorResponse(c, error);
  }
});

responsesRouter.get("/:id/input_items", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");
  const query = collectQueryParams(c);

  try {
    const result = await handleResponseInputItems(id, apiKeyId, query);
    return c.json(result.response);
  } catch (error) {
    const upstream = upstreamErrorResponse(c, error);
    if (upstream) return upstream;
    const relay = relayErrorResponse(c, error);
    if (relay) return relay;
    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof ResponseNotFoundError) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    return internalErrorResponse(c, error);
  }
});
