import { Hono } from "hono";
import { stream } from "hono/streaming";
import { apiKeyAuth } from "../../middleware/api-key";
import { flushLogBuffer, logRequest } from "../../middleware/logger";
import { ApiKeySpendLimitExceededError, assertApiKeyCanSpend } from "../keys/services";
import { ApiKeyUnbillableUsageError, handleChatCompletion } from "./services";
import type { ChatCompletionRequest } from "../../providers/types";

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

  if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "request must include a model and a non-empty messages array" }, 400);
  }

  if (isLimitedKey && body.stream) {
    return c.json({ error: "streaming is not supported for API keys with a spend limit" }, 429);
  }

  try {
    if (isLimitedKey) {
      await flushLogBuffer();
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const result = await handleChatCompletion(body, apiKeyId, {
      requireBillableUsage: isLimitedKey,
    });

    // Streaming response: pipe provider chunks to the client as SSE.
    if (result.kind === "stream") {
      const { stream: streamIterable, provider, model, startTime } = result;

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return stream(c, async (streamWriter) => {
        let totalTokens: number | undefined;
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;

        try {
          for await (const chunk of streamIterable) {
            await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);

            // Some providers emit a final chunk that includes a `usage` object.
            // Track it for logging purposes. We narrow the chunk via a runtime
            // check because `usage` is not part of the ChatCompletionChunk type.
            const maybeUsage = (
              chunk as {
                usage?: {
                  total_tokens?: number;
                  prompt_tokens?: number;
                  completion_tokens?: number;
                };
              }
            ).usage;
            if (maybeUsage) {
              if (typeof maybeUsage.total_tokens === "number")
                totalTokens = maybeUsage.total_tokens;
              if (typeof maybeUsage.prompt_tokens === "number")
                promptTokens = maybeUsage.prompt_tokens;
              if (typeof maybeUsage.completion_tokens === "number")
                completionTokens = maybeUsage.completion_tokens;
            }
          }

          await streamWriter.write("data: [DONE]\n\n");

          const latencyMs = Date.now() - startTime;
          logRequest({
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/chat/completions",
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens,
            statusCode: 200,
          });
        } catch (streamError) {
          const latencyMs = Date.now() - startTime;
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

          logRequest({
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/chat/completions",
            latencyMs,
            statusCode: 500,
            errorMessage,
          });

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

    if (error instanceof ApiKeyUnbillableUsageError) {
      return c.json({ error: errorMessage }, 429);
    }

    return c.json({ error: errorMessage }, 500);
  }
});
