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
import type { ImageGenerationRequest } from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { handleImageGeneration } from "./services";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";

export const imageGenerationsRouter = new Hono();

imageGenerationsRouter.use("*", apiKeyAuth);

imageGenerationsRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: ImageGenerationRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as ImageGenerationRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateImageGenerationRequestShape(body);
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

    const result = await handleImageGeneration(body, apiKeyId, {
      recordSpend: isLimitedKey && !body.stream,
      requestContext: {
        clientHeaders: c.req.raw.headers,
        requestPath: new URL(c.req.url).pathname,
      },
      rawBody,
    });

    if (result.kind === "stream") {
      const { stream: streamIterable, provider, model, channelId, channelName, startTime } = result;
      const logId = await logStreamStart({
        apiKeyId,
        provider,
        model,
        channelId,
        channelName,
        endpoint: "/v1/images/generations",
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
              console.error("Failed to record streamed image generation spend:", spendError);
            }
          }

          await logStreamFinal({
            logId,
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/images/generations",
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
          const latencyMs = Date.now() - startTime;
          const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

          try {
            if (!streamLogFinalized) {
              await logStreamFinal({
                logId,
                apiKeyId,
                provider,
                model,
                endpoint: "/v1/images/generations",
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

function validateImageGenerationRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";

  const request = value as Partial<ImageGenerationRequest>;

  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (typeof request.prompt !== "string" || request.prompt.length === 0) {
    return "request must include a prompt";
  }

  if (
    request.n !== undefined &&
    (typeof request.n !== "number" || !Number.isInteger(request.n) || request.n < 1)
  ) {
    return "n must be a positive integer";
  }

  if (
    request.response_format !== undefined &&
    request.response_format !== "url" &&
    request.response_format !== "b64_json"
  ) {
    return "response_format must be url or b64_json";
  }

  if (request.output_compression !== undefined) {
    if (
      typeof request.output_compression !== "number" ||
      !Number.isInteger(request.output_compression) ||
      request.output_compression < 0 ||
      request.output_compression > 100
    ) {
      return "output_compression must be an integer between 0 and 100";
    }
  }

  if (
    request.partial_images !== undefined &&
    (typeof request.partial_images !== "number" ||
      !Number.isInteger(request.partial_images) ||
      request.partial_images < 1)
  ) {
    return "partial_images must be a positive integer";
  }

  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    return "stream must be a boolean";
  }

  if (request.user !== undefined && typeof request.user !== "string") {
    return "user must be a string";
  }

  return null;
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
      const parsed = JSON.parse(data) as { usage?: unknown; response?: { usage?: unknown } };
      const usage = toUsageObject(parsed.usage) ?? toUsageObject(parsed.response?.usage);
      if (!usage) continue;

      const promptTokens =
        numberOrUndefined(usage.prompt_tokens) ?? numberOrUndefined(usage.input_tokens);
      const completionTokens =
        numberOrUndefined(usage.completion_tokens) ?? numberOrUndefined(usage.output_tokens);
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
