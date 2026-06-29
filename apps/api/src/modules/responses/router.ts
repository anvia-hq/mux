import type { Context } from "hono";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { UpstreamResponsesApiError } from "../../providers/openai";
import { estimateCost } from "../../providers/registry";
import {
  responseCompactRequestSchema,
  responseCreateRequestSchema,
} from "../../providers/responses-schema";
import { parseResponseStreamBlock, SseBlockParser } from "../../providers/responses-stream";
import type { ResponseCreateRequest, ResponseObject, ResponseUsage } from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
  assertApiKeyCanSpend,
} from "../keys/services";
import { authValidationHook } from "../auth/utils";
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

export const responsesRouter = new Hono();

responsesRouter.use("*", apiKeyAuth);

function upstreamErrorResponse(c: Context, error: unknown): Response | null {
  if (!(error instanceof UpstreamResponsesApiError)) {
    return null;
  }
  const envelope = error.jsonError;
  return c.json({ error: envelope ?? error.message }, error.status as 400 | 404 | 422 | 500);
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
  zValidator("json", responseCreateRequestSchema, authValidationHook),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
    const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

    const body = c.req.valid("json") as ResponseCreateRequest;
    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;

    if (body.background === true) {
      try {
        if (isLimitedKey) {
          await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
        }

        const submitted = await submitBackgroundResponse(body, apiKeyId, {
          requireBillableUsage: isLimitedKey,
        });
        c.header("Location", `/v1/responses/${submitted.id}`);
        return c.json(submitted.response, 202);
      } catch (error) {
        const upstream = upstreamErrorResponse(c, error);
        if (upstream) return upstream;

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

        return c.json({ error: errorMessage }, 500);
      }
    }

    try {
      if (isLimitedKey) {
        await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
      }

      if (body.stream === true) {
        const result = await handleResponseCreateStream(body);
        const { stream: streamIterable, provider, model, startTime } = result;
        const logId = await logStreamStart({
          apiKeyId,
          provider,
          model,
          endpoint: "/v1/responses",
          latencyMs: 0,
          statusCode: 102,
          errorMessage: "stream pending",
        });

        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        return honoStream(c, async (streamWriter) => {
          const blockParser = new SseBlockParser();
          let usage: ResponseUsage | undefined;

          try {
            for await (const chunk of streamIterable) {
              await streamWriter.write(chunk);
              for (const block of blockParser.push(chunk)) {
                const event = parseResponseStreamBlock(block);
                if (event?.type === "response.completed") {
                  usage = event.response.usage;
                }
              }
            }
            for (const block of blockParser.end()) {
              const event = parseResponseStreamBlock(block);
              if (event?.type === "response.completed") {
                usage = event.response.usage;
              }
            }

            const latencyMs = Date.now() - startTime;
            const estimatedCost = estimateCost(model, usage?.input_tokens, usage?.output_tokens);
            const reasoningTokens = readReasoningTokens(usage);

            if (isLimitedKey && estimatedCost !== undefined) {
              try {
                await addApiKeySpendUsd(apiKeyId, estimatedCost);
              } catch (spendError) {
                console.error("Failed to record streamed response spend:", spendError);
              }
            }

            try {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                endpoint: "/v1/responses",
                latencyMs,
                promptTokens: usage?.input_tokens,
                completionTokens: usage?.output_tokens,
                totalTokens: usage?.total_tokens,
                reasoningTokens,
                estimatedCost,
                statusCode: 200,
              });
            } catch (logError) {
              console.error("Failed to finalize response stream log:", logError);
            }
          } catch (streamError) {
            const latencyMs = Date.now() - startTime;
            const errorMessage =
              streamError instanceof Error ? streamError.message : "Unknown error";

            try {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                endpoint: "/v1/responses",
                latencyMs,
                statusCode: 500,
                errorMessage,
              });
            } catch (logError) {
              console.error("Failed to finalize failed response stream log:", logError);
            }

            throw streamError;
          }
        });
      }

      const response = await handleResponseCreate(body, apiKeyId, {
        requireBillableUsage: isLimitedKey,
      });

      return c.json(response);
    } catch (error) {
      const upstream = upstreamErrorResponse(c, error);
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

      return c.json({ error: errorMessage }, 500);
    }
  },
);

responsesRouter.post(
  "/compact",
  zValidator("json", responseCompactRequestSchema, authValidationHook),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
    const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;
    const body = c.req.valid("json") as ResponseCreateRequest;
    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;

    try {
      if (isLimitedKey) {
        await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
      }

      const result = await handleResponseCompact(body, apiKeyId, {
        requireBillableUsage: isLimitedKey,
      });
      return c.json(result.response);
    } catch (error) {
      const upstream = upstreamErrorResponse(c, error);
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

      return c.json({ error: errorMessage }, 500);
    }
  },
);

responsesRouter.post("/input_tokens", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;

  let body: ResponseCreateRequest;
  try {
    body = (await c.req.json()) as ResponseCreateRequest;
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (typeof body.model === "string") {
    const accessError = disallowedModelResponse(c, body.model);
    if (accessError) return accessError;
  }

  try {
    const result = await handleResponseInputTokens(body, apiKeyId);
    return c.json(result.response);
  } catch (error) {
    const upstream = upstreamErrorResponse(c, error);
    if (upstream) return upstream;

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

    return c.json({ error: errorMessage }, 500);
  }
});

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

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
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

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedResponseFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
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

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (error instanceof ResponseNotFoundError) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof OpenAIResponseProviderNotConfiguredError) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
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

    return c.json({ error: errorMessage }, 500);
  }
});
