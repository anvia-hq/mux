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
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
  assertApiKeyCanSpend,
} from "../keys/services";
import { ApiKeyUnbillableUsageError, handleChatCompletion } from "./services";
import type { ChatCompletionChunk, ChatCompletionRequest } from "../../providers/types";

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

  let body: ChatCompletionRequest;
  try {
    body = (await c.req.json()) as ChatCompletionRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateChatCompletionRequestShape(body);
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

  if (isLimitedKey && body.stream) {
    return c.json({ error: "streaming is not supported for API keys with a spend limit" }, 429);
  }

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const result = await handleChatCompletion(body, apiKeyId, {
      requireBillableUsage: isLimitedKey,
    });

    // Streaming response: pipe provider chunks to the client as SSE.
    if (result.kind === "stream") {
      const { stream: streamIterable, provider, model, startTime } = result;
      const logId = await logStreamStart({
        apiKeyId,
        provider,
        model,
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
          await logStreamFinal({
            logId,
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/chat/completions",
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCost: estimateCost(model, promptTokens, completionTokens),
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

            if (isTerminalChatCompletionChunk(chunk)) {
              try {
                await finalizeSuccessfulStreamLog();
              } catch (logError) {
                console.error("Failed to finalize request log:", logError);
              }
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
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof ApiKeySpendLimitExceededError) {
      return c.json({ error: errorMessage }, 429);
    }

    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: errorMessage }, 403);
    }

    if (error instanceof ApiKeyUnbillableUsageError) {
      return c.json({ error: errorMessage }, 429);
    }

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    if (error instanceof UnsupportedChatFeatureError) {
      return c.json({ error: errorMessage }, 422);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

function isTerminalChatCompletionChunk(chunk: ChatCompletionChunk): boolean {
  return chunk.choices.some((choice) => choice.finish_reason !== null);
}
