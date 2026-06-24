import type { Context } from "hono";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { apiKeyAuth } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { UpstreamResponsesApiError } from "../../providers/openai";
import { estimateCost } from "../../providers/registry";
import { responseCreateRequestSchema } from "../../providers/responses-schema";
import { parseResponseStreamBlock, SseBlockParser } from "../../providers/responses-stream";
import type { ResponseCreateRequest, ResponseUsage } from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
} from "../keys/services";
import { authValidationHook } from "../auth/utils";
import {
  ApiKeyUnbillableResponseUsageError,
  handleResponseCancel,
  handleResponseCreate,
  handleResponseCreateStream,
  handleResponseDelete,
  handleResponseRetrieve,
  OpenAIResponseProviderNotConfiguredError,
  ResponseNotFoundError,
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

responsesRouter.post(
  "/",
  zValidator("json", responseCreateRequestSchema, authValidationHook),
  async (c) => {
    const apiKeyId = c.get("apiKeyId" as never) as string;
    const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
    const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

    const body = c.req.valid("json") as ResponseCreateRequest;

    if (body.background === true) {
      return c.json({ error: "Responses background mode is not supported yet" }, 422);
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
              estimatedCost,
              statusCode: 200,
            });
          } catch (logError) {
            console.error("Failed to finalize response stream log:", logError);
          }
        } catch (streamError) {
          const latencyMs = Date.now() - startTime;
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

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

responsesRouter.get("/:id", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const id = c.req.param("id");
  const query = collectQueryParams(c);

  try {
    const response = await handleResponseRetrieve(id, apiKeyId, query);
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
