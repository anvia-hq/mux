import type { Context } from "hono";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { apiKeyAuthWithAnthropicHeader, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { UpstreamAnthropicMessagesApiError } from "../../providers/anthropic";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";
import {
  estimateCost,
  resolveAnthropicMessageTokenCountAccessModelId,
  resolveAnthropicMessagesAccessModelId,
} from "../../providers/registry";
import type {
  AnthropicMessageCountTokensRequest,
  AnthropicMessageCreateRequest,
} from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import {
  ApiKeyUnbillableAnthropicMessageUsageError,
  handleAnthropicMessage,
  handleAnthropicMessageTokenCount,
} from "./services";

export const messagesRouter = new Hono();

messagesRouter.use("*", apiKeyAuthWithAnthropicHeader);

messagesRouter.post("/count_tokens", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;

  let rawBody: string;
  let body: AnthropicMessageCountTokensRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as AnthropicMessageCountTokensRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateAnthropicMessageRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  try {
    const accessModelId = await resolveAnthropicMessageTokenCountAccessModelId(body.model);
    assertApiKeyModelAllowed(accessModelId, readApiKeyModelAccess(c));
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }

  try {
    const result = await handleAnthropicMessageTokenCount(body, apiKeyId, {
      providerOptions: providerOptionsFromHono(c),
      requestContext: requestContextFromHono(c),
      rawBody,
    });
    return c.json(result.response);
  } catch (error) {
    const upstream = upstreamAnthropicErrorResponse(error);
    if (upstream) return upstream;

    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.startsWith("No provider found")) {
      return c.json({ error: errorMessage }, 404);
    }

    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: errorMessage }, 403);
    }

    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    if (error instanceof RequestLoggingUnavailableError) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

messagesRouter.post("/", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let rawBody: string;
  let body: AnthropicMessageCreateRequest;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody) as AnthropicMessageCreateRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateAnthropicMessageRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  try {
    const accessModelId = await resolveAnthropicMessagesAccessModelId(body.model);
    assertApiKeyModelAllowed(accessModelId, readApiKeyModelAccess(c));
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

    const result = await handleAnthropicMessage(body, apiKeyId, {
      requireBillableUsage: isLimitedKey && body.stream !== true,
      providerOptions: providerOptionsFromHono(c),
      requestContext: requestContextFromHono(c),
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
        endpoint: "/v1/messages",
        latencyMs: 0,
        statusCode: 102,
        errorMessage: "stream pending",
      });

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return stream(c, async (streamWriter) => {
        const usageTracker = new AnthropicSseUsageTracker();
        let streamLogFinalized = false;

        async function finalizeSuccessfulStreamLog() {
          if (streamLogFinalized) return;
          streamLogFinalized = true;
          usageTracker.end();

          const latencyMs = Date.now() - startTime;
          const usage = usageTracker.usage();
          const estimatedCost = estimateCost(model, usage.promptTokens, usage.completionTokens);

          if (isLimitedKey && estimatedCost !== undefined) {
            try {
              await addApiKeySpendUsd(apiKeyId, estimatedCost);
            } catch (spendError) {
              console.error("Failed to record streamed Anthropic Messages spend:", spendError);
            }
          }

          await logStreamFinal({
            logId,
            apiKeyId,
            provider,
            model,
            channelId,
            channelName,
            endpoint: "/v1/messages",
            latencyMs,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            estimatedCost,
            statusCode: 200,
          });
        }

        try {
          for await (const chunk of streamIterable) {
            usageTracker.push(chunk);
            await streamWriter.write(chunk);
          }

          try {
            await finalizeSuccessfulStreamLog();
          } catch (logError) {
            console.error("Failed to finalize Anthropic Messages stream log:", logError);
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
                endpoint: "/v1/messages",
                latencyMs,
                statusCode: 500,
                errorMessage,
              });
              streamLogFinalized = true;
            }
          } catch (logError) {
            console.error("Failed to finalize failed Anthropic Messages stream log:", logError);
          }

          throw streamError;
        }
      });
    }

    return c.json(result.response);
  } catch (error) {
    const upstream = upstreamAnthropicErrorResponse(error);
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

    if (error instanceof ApiKeyUnbillableAnthropicMessageUsageError) {
      return c.json({ error: errorMessage }, 429);
    }

    const channelOverride = channelOverrideErrorResponse(c, error);
    if (channelOverride) return channelOverride;

    if (
      error instanceof RequestLoggingUnavailableError ||
      error instanceof ApiKeySpendLedgerUnavailableError
    ) {
      return c.json({ error: errorMessage }, 503);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

function providerOptionsFromHono(c: Context) {
  const headers: Record<string, string> = {
    "anthropic-version": c.req.header("anthropic-version")?.trim() || "2023-06-01",
  };
  const anthropicBeta = c.req.header("anthropic-beta")?.trim();
  if (anthropicBeta) {
    headers["anthropic-beta"] = anthropicBeta;
  }
  return { headers };
}

function requestContextFromHono(c: Context) {
  return {
    clientHeaders: c.req.raw.headers,
    requestPath: new URL(c.req.url).pathname,
  };
}

function channelOverrideErrorResponse(c: Context, error: unknown): Response | null {
  if (error instanceof ChannelParamOverrideError) {
    return c.json(
      { error: error.message },
      error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    );
  }

  if (error instanceof ChannelHeaderOverrideError) {
    return c.json({ error: error.message }, 400);
  }

  return null;
}

function validateAnthropicMessageRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "request body must be an object";
  }

  const request = value as Partial<AnthropicMessageCreateRequest>;
  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return "request must include a non-empty messages array";
  }

  if (
    request.max_tokens !== undefined &&
    (typeof request.max_tokens !== "number" ||
      !Number.isInteger(request.max_tokens) ||
      request.max_tokens < 1)
  ) {
    return "max_tokens must be a positive integer";
  }

  if (request.stream !== undefined && typeof request.stream !== "boolean") {
    return "stream must be a boolean";
  }

  return null;
}

function upstreamAnthropicErrorResponse(error: unknown): Response | null {
  if (!(error instanceof UpstreamAnthropicMessagesApiError)) {
    return null;
  }

  return new Response(error.body, {
    status: error.status,
    headers: {
      "Content-Type": error.contentType ?? "application/json",
    },
  });
}

class AnthropicSseUsageTracker {
  private buffer = "";
  private promptTokens: number | undefined;
  private completionTokens: number | undefined;

  push(chunk: string) {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      this.readBlock(block);
    }
  }

  end() {
    if (this.buffer.trim()) {
      this.readBlock(this.buffer);
    }
    this.buffer = "";
  }

  usage(): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
    const totalTokens =
      this.promptTokens === undefined && this.completionTokens === undefined
        ? undefined
        : (this.promptTokens ?? 0) + (this.completionTokens ?? 0);
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens,
    };
  }

  private readBlock(block: string) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();

    if (!data || data === "[DONE]") return;

    try {
      const event = JSON.parse(data) as {
        message?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      };
      const usage = event.message?.usage ?? event.usage;
      if (!usage) return;

      if (typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens)) {
        this.promptTokens = usage.input_tokens;
      }
      if (typeof usage.output_tokens === "number" && Number.isFinite(usage.output_tokens)) {
        this.completionTokens = usage.output_tokens;
      }
    } catch {
      return;
    }
  }
}
