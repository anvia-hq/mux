import { Hono } from "hono";
import { stream } from "hono/streaming";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { estimateCost } from "../../providers/registry";
import {
  UnsupportedChatFeatureError,
  validateChatCompletionRequestShape,
} from "../../providers/chat-compat";
import {
  addApiKeySpendUsd,
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
  assertApiKeyCanSpend,
} from "../keys/services";
import { ApiKeyUnbillableUsageError, handleChatCompletion } from "./services";
import type { ChatCompletionChunk, ChatCompletionRequest } from "../../providers/types";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";

function openAIErrorBody(
  message: string,
  type = "invalid_request_error",
  code: string | null = "invalid_request",
  param: string | null = null,
) {
  return {
    error: {
      message,
      type,
      param,
      code,
    },
  };
}

function shouldWriteStreamChunk(chunk: ChatCompletionChunk, includeUsage: boolean): boolean {
  if (includeUsage || !chunk.usage) return true;

  return chunk.choices.some((choice) => {
    const delta = choice.delta as { content?: unknown; reasoning_content?: unknown };
    return (
      (typeof delta.content === "string" && delta.content !== "") ||
      (typeof delta.reasoning_content === "string" && delta.reasoning_content !== "")
    );
  });
}

/**
 * Router exposing the OpenAI-compatible chat completions endpoint.
 *
 * All routes require a valid API key (validated by the apiKeyAuth middleware).
 * The single POST /completions handler accepts both streaming and
 * non-streaming requests and returns responses in OpenAI's chat.completions
 * shape.
 */
export const chatRouter = new Hono();

chatRouter.use("*", apiKeyAuth);

chatRouter.post("/completions", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: ChatCompletionRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as ChatCompletionRequest;
  } catch {
    return c.json(
      openAIErrorBody("invalid JSON body", "invalid_request_error", "bad_request_body"),
      400,
    );
  }

  const validationError = validateChatCompletionRequestShape(body);
  if (validationError) {
    return c.json(openAIErrorBody(validationError), 400);
  }

  try {
    assertApiKeyModelAllowed(body.model, readApiKeyModelAccess(c));
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json(openAIErrorBody(error.message, "invalid_request_error", "access_denied"), 403);
    }
    throw error;
  }

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const result = await handleChatCompletion(body, apiKeyId, {
      requireBillableUsage: isLimitedKey && !body.stream,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });

    // Streaming response: pipe provider chunks to the client as SSE.
    if (result.kind === "stream") {
      const { stream: streamIterable, provider, model, channelId, channelName, startTime } = result;
      const includeStreamUsage = body.stream_options?.include_usage ?? true;
      const logId = await logStreamStart({
        apiKeyId,
        provider,
        model,
        channelId,
        channelName,
        endpoint: "/v1/chat/completions",
        latencyMs: 0,
        statusCode: 102,
        errorMessage: "stream pending",
      });

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return stream(c, async (streamWriter) => {
        let totalTokens: number | undefined;
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;
        let streamLogFinalized = false;

        async function finalizeSuccessfulStreamLog() {
          if (streamLogFinalized) return;
          streamLogFinalized = true;

          const latencyMs = Date.now() - startTime;
          const estimatedCost = estimateCost(model, promptTokens, completionTokens);

          if (isLimitedKey && estimatedCost !== undefined) {
            try {
              await addApiKeySpendUsd(apiKeyId, estimatedCost);
            } catch (spendError) {
              console.error("Failed to record streamed chat spend:", spendError);
            }
          }

          await logStreamFinal({
            logId,
            apiKeyId,
            provider,
            model,
            channelId,
            channelName,
            endpoint: "/v1/chat/completions",
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCost,
            statusCode: 200,
          });
        }

        try {
          for await (const chunk of streamIterable) {
            // Some providers emit a final chunk that includes a `usage` object.
            // Track it for logging purposes.
            const maybeUsage = chunk.usage;
            if (maybeUsage) {
              if (typeof maybeUsage.total_tokens === "number")
                totalTokens = maybeUsage.total_tokens;
              if (typeof maybeUsage.prompt_tokens === "number")
                promptTokens = maybeUsage.prompt_tokens;
              if (typeof maybeUsage.completion_tokens === "number")
                completionTokens = maybeUsage.completion_tokens;
            }

            if (!shouldWriteStreamChunk(chunk, includeStreamUsage)) {
              continue;
            }

            await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }

          await streamWriter.write("data: [DONE]\n\n");

          try {
            await finalizeSuccessfulStreamLog();
          } catch (logError) {
            console.error("Failed to finalize request log:", logError);
          }
        } catch (streamError) {
          const latencyMs = Date.now() - startTime;
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

          try {
            if (!streamLogFinalized) {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                channelId,
                channelName,
                endpoint: "/v1/chat/completions",
                latencyMs,
                statusCode: 500,
                errorMessage,
              });
              streamLogFinalized = true;
            }
          } catch (logError) {
            console.error("Failed to finalize failed request log:", logError);
          }

          throw streamError;
        }
      });
    }

    // Non-streaming response: return the OpenAI-compatible JSON body directly.
    return c.json(result.response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.startsWith("No provider found")) {
      return c.json(openAIErrorBody(errorMessage, "invalid_request_error", "model_not_found"), 404);
    }

    if (error instanceof ApiKeySpendLimitExceededError) {
      return c.json(openAIErrorBody(errorMessage, "insufficient_quota", "insufficient_quota"), 429);
    }

    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json(openAIErrorBody(errorMessage, "invalid_request_error", "access_denied"), 403);
    }

    if (error instanceof ApiKeyUnbillableUsageError) {
      return c.json(openAIErrorBody(errorMessage, "insufficient_quota", "insufficient_quota"), 429);
    }

    if (error instanceof ChannelParamOverrideError) {
      return c.json(
        openAIErrorBody(error.message, error.type, error.code),
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
      );
    }

    if (error instanceof ChannelHeaderOverrideError) {
      return c.json(
        openAIErrorBody(error.message, "invalid_request_error", "invalid_request"),
        400,
      );
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json(openAIErrorBody(errorMessage, "server_error", "service_unavailable"), 503);
    }

    if (error instanceof UnsupportedChatFeatureError) {
      return c.json(
        openAIErrorBody(errorMessage, "invalid_request_error", "unsupported_feature"),
        422,
      );
    }

    return c.json(openAIErrorBody(errorMessage, "server_error", "internal_error"), 500);
  }
});
