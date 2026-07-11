import { Hono } from "hono";
import { stream } from "hono/streaming";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { estimateCost } from "../../providers/registry";
import { upstreamOpenAICompatibleErrorResponse } from "../../providers/openai-compatible-error";
import type { CompletionRequest } from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { ApiKeyUnbillableCompletionUsageError, handleCompletion } from "./services";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";

export const completionsRouter = new Hono();

completionsRouter.use("*", apiKeyAuth);

completionsRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: CompletionRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as CompletionRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateCompletionRequestShape(body);
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

    const result = await handleCompletion(body, apiKeyId, {
      requireBillableUsage: isLimitedKey && !body.stream,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });

    if (result.kind === "stream") {
      const { stream: streamIterable, provider, model, channelId, channelName, latencyMs } = result;
      const logId = await logStreamStart({
        apiKeyId,
        provider,
        model,
        channelId,
        channelName,
        endpoint: "/v1/completions",
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

          const estimatedCost = estimateCost(model, promptTokens, completionTokens);

          if (isLimitedKey && estimatedCost !== undefined) {
            try {
              await addApiKeySpendUsd(apiKeyId, estimatedCost);
            } catch (spendError) {
              console.error("Failed to record streamed completion spend:", spendError);
            }
          }

          await logStreamFinal({
            logId,
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/completions",
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
            const usage = extractUsageFromRawSseChunk(chunk);
            if (usage.totalTokens !== undefined) totalTokens = usage.totalTokens;
            if (usage.promptTokens !== undefined) promptTokens = usage.promptTokens;
            if (usage.completionTokens !== undefined) completionTokens = usage.completionTokens;

            await streamWriter.write(chunk);
          }

          try {
            await finalizeSuccessfulStreamLog();
          } catch (logError) {
            console.error("Failed to finalize request log:", logError);
          }
        } catch (streamError) {
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

          try {
            if (!streamLogFinalized) {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                endpoint: "/v1/completions",
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

    return c.json(result.response);
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

    if (error instanceof ApiKeyUnbillableCompletionUsageError) {
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

function validateCompletionRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";

  const request = value as Partial<CompletionRequest>;

  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (!("prompt" in request)) {
    return "request must include prompt";
  }

  const promptError = validateCompletionPrompt(request.prompt);
  if (promptError) return promptError;

  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    return "stream must be a boolean";
  }

  if (
    request.max_tokens !== undefined &&
    (typeof request.max_tokens !== "number" ||
      !Number.isInteger(request.max_tokens) ||
      request.max_tokens < 0)
  ) {
    return "max_tokens must be a non-negative integer";
  }

  if (
    request.n !== undefined &&
    (typeof request.n !== "number" || !Number.isInteger(request.n) || request.n < 1)
  ) {
    return "n must be a positive integer";
  }

  if (
    request.best_of !== undefined &&
    (typeof request.best_of !== "number" ||
      !Number.isInteger(request.best_of) ||
      request.best_of < 1)
  ) {
    return "best_of must be a positive integer";
  }

  if (request.echo !== undefined && typeof request.echo !== "boolean") {
    return "echo must be a boolean";
  }

  if (request.user !== undefined && typeof request.user !== "string") {
    return "user must be a string";
  }

  return null;
}

function validateCompletionPrompt(prompt: unknown): string | null {
  if (typeof prompt === "string") {
    return prompt.length === 0 ? "prompt string must not be empty" : null;
  }

  if (!Array.isArray(prompt)) {
    return "prompt must be a string, array of strings, array of token ids, or array of token id arrays";
  }

  if (prompt.length === 0) {
    return "prompt array must not be empty";
  }

  if (prompt.every((item) => typeof item === "string")) {
    return prompt.some((item) => item.length === 0) ? "prompt strings must not be empty" : null;
  }

  if (prompt.every(isTokenId)) {
    return null;
  }

  if (prompt.every(Array.isArray)) {
    for (const [index, tokenIds] of prompt.entries()) {
      if (tokenIds.length === 0) {
        return `prompt[${index}] token id array must not be empty`;
      }
      if (!tokenIds.every(isTokenId)) {
        return `prompt[${index}] must contain only token ids`;
      }
    }
    return null;
  }

  return "prompt array must contain only strings, token ids, or token id arrays";
}

function isTokenId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function extractUsageFromRawSseChunk(chunk: string): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const result: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } = {};

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data: ")) continue;

    const data = line.slice(6);
    if (data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as { usage?: unknown };
      const usage = toUsageObject(parsed.usage);
      if (!usage) continue;

      const promptTokens = numberOrUndefined(usage.prompt_tokens);
      const completionTokens = numberOrUndefined(usage.completion_tokens);
      const totalTokens = numberOrUndefined(usage.total_tokens);

      if (promptTokens !== undefined) result.promptTokens = promptTokens;
      if (completionTokens !== undefined) result.completionTokens = completionTokens;
      if (totalTokens !== undefined) result.totalTokens = totalTokens;
    } catch {}
  }

  return result;
}

function toUsageObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
