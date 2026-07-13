import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { openAIApiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import { logStreamFinal, logStreamStart } from "../../middleware/logger";
import {
  UnsupportedChatFeatureError,
  validateChatCompletionRequestShape,
} from "../../providers/chat-compat";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";
import type { ChatCompletionChunk, ChatCompletionRequest } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
} from "../keys/services";
import {
  ApiKeyUnbillableUsageError,
  handleChatCompletion,
  type ChatCompletionUsage,
} from "./services";
import { chatRelayConfig } from "./relay/config";
import {
  ChatRelayClientAbortError,
  ChatRelayProtocolError,
  ChatRelayTimeoutError,
  internalRelayErrorMessage,
  sanitizedRelayError,
} from "./relay/errors";
import { ChatRequestBodyError, readChatRequestBody } from "./relay/request-body";
import {
  ChatRateLimitExceededError,
  ChatRateLimitUnavailableError,
  checkChatRateLimit,
  recordChatRateLimitSuccess,
} from "./relay/rate-limit";
import { UpstreamOpenAICompatibleError } from "../../providers/openai-compatible-error";

function openAIErrorBody(
  message: string,
  type = "invalid_request_error",
  code: string | null = "invalid_request",
  param: string | null = null,
) {
  return { error: { message, type, param, code } };
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

export const chatRouter = new Hono();

chatRouter.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId" as never, requestId);
  c.header("x-request-id", requestId);
  await next();
});
chatRouter.use("*", openAIApiKeyAuth);

chatRouter.post("/completions", async (c) => {
  const requestId = c.get("requestId" as never) as string;
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const legacySpendLimit = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const apiKeyLimit = c.get("apiKeyOwnSpendLimitUsd" as never) as number | null | undefined;
  const ownerId = c.get("apiKeyOwnerId" as never) as string | undefined;
  const ownerLimit = c.get("apiKeyOwnerSpendLimitUsd" as never) as number | null | undefined;
  const effectiveApiKeyLimit = apiKeyLimit === undefined ? legacySpendLimit : apiKeyLimit;
  const limited = effectiveApiKeyLimit != null || ownerLimit != null;

  try {
    await checkChatRateLimit(apiKeyId, chatRelayConfig);
  } catch (error) {
    if (error instanceof ChatRateLimitExceededError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json(openAIErrorBody(error.message, "rate_limit_error", "rate_limit_exceeded"), 429);
    }
    if (error instanceof ChatRateLimitUnavailableError) {
      return c.json(openAIErrorBody(error.message, "server_error", "service_unavailable"), 503);
    }
    throw error;
  }

  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType && contentType !== "application/json" && !contentType.endsWith("+json")) {
    return c.json(
      openAIErrorBody(
        "content type must be application/json",
        "invalid_request_error",
        "unsupported_media_type",
      ),
      415,
    );
  }

  let rawBody: string;
  let body: ChatCompletionRequest;
  try {
    rawBody = await readChatRequestBody(c.req.raw, chatRelayConfig.maxRequestBodyBytes);
    body = JSON.parse(rawBody) as ChatCompletionRequest;
  } catch (error) {
    if (error instanceof ChatRequestBodyError) {
      return c.json(
        openAIErrorBody(error.message, "invalid_request_error", error.code),
        error.status,
      );
    }
    return c.json(
      openAIErrorBody("invalid JSON body", "invalid_request_error", "bad_request_body"),
      400,
    );
  }

  const validationError = validateChatCompletionRequestShape(body);
  if (validationError) return c.json(openAIErrorBody(validationError), 400);

  try {
    assertApiKeyModelAllowed(body.model, readApiKeyModelAccess(c));
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json(openAIErrorBody(error.message, "invalid_request_error", "access_denied"), 403);
    }
    throw error;
  }

  try {
    const result = await handleChatCompletion(body, apiKeyId, {
      requireBillableUsage: limited,
      billing: limited
        ? {
            apiKeyId,
            ownerId,
            apiKeyLimitUsd: effectiveApiKeyLimit,
            ownerLimitUsd: ownerLimit,
          }
        : undefined,
      requestId,
      signal: c.req.raw.signal,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });

    if (result.kind === "complete") {
      await safeRecordRateLimitSuccess(apiKeyId, requestId);
      return c.json(result.response);
    }

    const includeStreamUsage = body.stream_options?.include_usage ?? true;
    const logId = await safeStartStreamLog({
      apiKeyId,
      provider: result.provider,
      model: result.model,
      requestedModel: result.responseModel,
      channelId: result.channelId,
      channelName: result.channelName,
      endpoint: "/v1/chat/completions",
      latencyMs: 0,
      statusCode: 102,
      errorMessage: "stream pending",
    });

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return stream(c, async (streamWriter) => {
      const usage: ChatCompletionUsage = {};
      let finalized = false;
      let aborted = false;

      const finalize = async (statusCode: number, errorMessage?: string) => {
        if (finalized) return;
        finalized = true;
        let estimatedCost: number | undefined;
        try {
          estimatedCost = await result.finalizeSpend(usage);
        } catch (error) {
          console.error("chat_spend_settlement_failed", {
            requestId,
            error: internalRelayErrorMessage(error),
          });
        }
        if (logId) {
          try {
            await logStreamFinal({
              logId,
              apiKeyId,
              provider: result.provider,
              model: result.model,
              requestedModel: result.responseModel,
              channelId: result.channelId,
              channelName: result.channelName,
              endpoint: "/v1/chat/completions",
              latencyMs: result.latencyMs,
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
              pricingInputTokens: usage.pricing_input_tokens,
              estimatedCost,
              statusCode,
              errorMessage,
            });
          } catch (error) {
            console.error("chat_request_log_failed", {
              requestId,
              error: internalRelayErrorMessage(error),
            });
          }
        }
      };

      streamWriter.onAbort(async () => {
        aborted = true;
        result.abort();
        await finalize(499, "client disconnected");
      });

      try {
        for await (const chunk of result.stream) {
          if (chunk.usage) {
            if (typeof chunk.usage.prompt_tokens === "number")
              usage.prompt_tokens = chunk.usage.prompt_tokens;
            if (typeof chunk.usage.completion_tokens === "number")
              usage.completion_tokens = chunk.usage.completion_tokens;
            if (typeof chunk.usage.total_tokens === "number")
              usage.total_tokens = chunk.usage.total_tokens;
            if (typeof chunk.usage.pricing_input_tokens === "number")
              usage.pricing_input_tokens = chunk.usage.pricing_input_tokens;
          }
          if (shouldWriteStreamChunk(chunk, includeStreamUsage)) {
            await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
        if (!aborted) {
          await streamWriter.write("data: [DONE]\n\n");
          await finalize(200);
          await safeRecordRateLimitSuccess(apiKeyId, requestId);
        }
      } catch (error) {
        if (!aborted) {
          const sanitized = sanitizedRelayError(error, requestId);
          try {
            await streamWriter.write(`data: ${JSON.stringify(sanitized.body)}\n\n`);
          } catch {
            // The downstream may have disappeared between the iterator failure and this write.
          }
          await finalize(sanitized.status, internalRelayErrorMessage(error));
        }
      }
    });
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
      return c.json(openAIErrorBody(error.message), 400);
    }
    if (error instanceof ApiKeySpendLedgerUnavailableError) {
      return c.json(openAIErrorBody(errorMessage, "server_error", "service_unavailable"), 503);
    }
    if (error instanceof UnsupportedChatFeatureError) {
      return c.json(
        openAIErrorBody(errorMessage, "invalid_request_error", "unsupported_feature"),
        422,
      );
    }
    if (
      error instanceof UpstreamOpenAICompatibleError ||
      error instanceof ChatRelayTimeoutError ||
      error instanceof ChatRelayProtocolError ||
      error instanceof TypeError
    ) {
      const sanitized = sanitizedRelayError(error, requestId);
      if (sanitized.retryAfter) c.header("Retry-After", sanitized.retryAfter);
      return c.json(
        sanitized.body,
        sanitized.status as 400 | 401 | 403 | 404 | 408 | 409 | 425 | 429 | 500 | 502 | 503 | 504,
      );
    }
    if (error instanceof ChatRelayClientAbortError) {
      return new Response(
        JSON.stringify(openAIErrorBody(error.message, "request_aborted", "client_disconnected")),
        {
          status: 499,
          headers: { "Content-Type": "application/json", "x-request-id": requestId },
        },
      );
    }
    return c.json(openAIErrorBody("Internal server error", "server_error", "internal_error"), 500);
  }
});

async function safeStartStreamLog(entry: Parameters<typeof logStreamStart>[0]) {
  try {
    return await logStreamStart(entry);
  } catch (error) {
    console.error("chat_request_log_failed", { error: internalRelayErrorMessage(error) });
    return undefined;
  }
}

async function safeRecordRateLimitSuccess(apiKeyId: string, requestId: string) {
  try {
    await recordChatRateLimitSuccess(apiKeyId, chatRelayConfig);
  } catch (error) {
    console.error("chat_rate_limit_success_record_failed", {
      requestId,
      error: internalRelayErrorMessage(error),
    });
  }
}
