import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { apiKeyAuthWithAnthropicHeader, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
} from "../../providers/channel-overrides";
import { UpstreamAnthropicMessagesApiError } from "../../providers/anthropic";
import {
  resolveAnthropicMessageTokenCountAccessModelId,
  resolveAnthropicMessagesAccessModelId,
} from "../../providers/registry";
import type {
  AnthropicMessageCountTokensRequest,
  AnthropicMessageCreateRequest,
} from "../../providers/types";
import { ChatRequestBodyError, readChatRequestBody } from "../chat/relay/request-body";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyModelAllowed,
} from "../keys/services";
import {
  ApiKeyUnbillableAnthropicMessageUsageError,
  handleAnthropicMessage,
  handleAnthropicMessageTokenCount,
} from "./services";
import { messagesRelayConfig } from "./relay/config";
import {
  anthropicErrorBody,
  anthropicRelayError,
  MessagesRelayClientAbortError,
  MessagesRelayProtocolError,
  MessagesRelayTimeoutError,
  messagesRelayStatus,
} from "./relay/errors";
import {
  checkMessagesRateLimit,
  MessagesRateLimitExceededError,
  MessagesRateLimitUnavailableError,
  recordMessagesRateLimitSuccess,
} from "./relay/rate-limit";
import { estimateAnthropicStreamOutputTokens } from "./relay/token-estimator";

export const messagesRouter = new Hono();

messagesRouter.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId" as never, requestId);
  c.header("x-request-id", requestId);
  await next();
});
messagesRouter.use("*", apiKeyAuthWithAnthropicHeader);

messagesRouter.post("/count_tokens", enforceMessagesRateLimit, async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const parsed = await parseAnthropicBody<AnthropicMessageCountTokensRequest>(c);
  if (parsed instanceof Response) return parsed;
  const { body, rawBody } = parsed;

  const accessError = await modelAccessError(
    c,
    body.model,
    resolveAnthropicMessageTokenCountAccessModelId,
  );
  if (accessError) return accessError;

  try {
    const result = await handleAnthropicMessageTokenCount(body, apiKeyId, {
      providerOptions: providerOptionsFromHono(c),
      requestContext: requestContextFromHono(c),
      rawBody,
      requestId: requestIdFromHono(c),
      signal: c.req.raw.signal,
    });
    copyUpstreamHeaders(c, result.headers);
    await safeRecordMessagesSuccess(c);
    return c.json(result.response, result.status as 200);
  } catch (error) {
    return messagesErrorResponse(c, error);
  }
});

messagesRouter.post("/", enforceMessagesRateLimit, async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const parsed = await parseAnthropicBody<AnthropicMessageCreateRequest>(c);
  if (parsed instanceof Response) return parsed;
  const { body, rawBody } = parsed;

  const accessError = await modelAccessError(c, body.model, resolveAnthropicMessagesAccessModelId);
  if (accessError) return accessError;
  const { limited, billing } = billingOptions(c);

  try {
    const result = await handleAnthropicMessage(body, apiKeyId, {
      requireBillableUsage: limited,
      billing,
      providerOptions: providerOptionsFromHono(c),
      requestContext: requestContextFromHono(c),
      rawBody,
      requestId: requestIdFromHono(c),
      signal: c.req.raw.signal,
    });

    if (result.kind === "complete") {
      copyUpstreamHeaders(c, result.headers);
      await safeRecordMessagesSuccess(c);
      return c.json(result.response, result.status as 200);
    }

    const {
      stream: streamIterable,
      provider,
      model,
      channelId,
      channelName,
      latencyMs,
      abort,
      refundSpend,
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
        endpoint: "/v1/messages",
        latencyMs: 0,
        statusCode: 102,
        errorMessage: "stream pending",
      });
    } catch (error) {
      abort();
      try {
        await refundSpend();
      } catch (settlementError) {
        logSettlementFailure(c, settlementError);
      }
      throw error;
    }

    copyUpstreamHeaders(c, result.headers);
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return honoStream(c, async (streamWriter) => {
      const tracker = new AnthropicSseTracker();
      let finalized = false;

      const finalize = async (statusCode: number, errorMessage?: string) => {
        if (finalized) return;
        finalized = true;
        tracker.end(requestIdFromHono(c));
        const usage = tracker.usage();
        let estimatedCost: number | undefined;
        try {
          estimatedCost = await finalizeSpend(usage, tracker.outputTokenEstimate);
        } catch (error) {
          logSettlementFailure(c, error);
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
            endpoint: "/v1/messages",
            latencyMs,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            pricingInputTokens: usage.pricingInputTokens,
            estimatedCost,
            statusCode,
            errorMessage,
          });
        } catch (logError) {
          console.error("anthropic_messages_stream_log_failed", {
            requestId: requestIdFromHono(c),
            error: logError instanceof Error ? logError.message : String(logError),
          });
        }
      };

      streamWriter.onAbort(async () => {
        abort();
        await finalize(499, "client disconnected");
      });

      try {
        for await (const chunk of streamIterable) {
          for (const output of tracker.push(chunk, requestIdFromHono(c))) {
            await streamWriter.write(output);
          }
        }
        for (const output of tracker.end(requestIdFromHono(c))) {
          await streamWriter.write(output);
        }
        if (!tracker.terminal) {
          throw new MessagesRelayProtocolError(
            "Upstream stream ended without a terminal message event",
          );
        }
        const terminalError = tracker.terminalError;
        await finalize(terminalError ? 502 : result.status, terminalError);
        if (!terminalError) await safeRecordMessagesSuccess(c);
      } catch (streamError) {
        const status = messagesRelayStatus(streamError);
        const message =
          streamError instanceof Error ? streamError.message : "Upstream stream failed";
        await finalize(status, message);
        if (!(streamError instanceof MessagesRelayClientAbortError)) {
          try {
            const sanitized = anthropicRelayError(streamError, requestIdFromHono(c));
            await streamWriter.write(`event: error\ndata: ${JSON.stringify(sanitized.body)}\n\n`);
          } catch {
            // The downstream may already be gone.
          }
        }
      }
    });
  } catch (error) {
    return messagesErrorResponse(c, error);
  }
});

async function parseAnthropicBody<T extends AnthropicMessageCountTokensRequest>(
  c: Context,
): Promise<{ body: T; rawBody: string } | Response> {
  const requestId = requestIdFromHono(c);
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType && contentType !== "application/json" && !contentType.endsWith("+json")) {
    return c.json(anthropicErrorBody("content type must be application/json", requestId), 415);
  }

  let rawBody: string;
  let body: unknown;
  try {
    rawBody = await readChatRequestBody(c.req.raw, messagesRelayConfig.maxRequestBodyBytes);
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof ChatRequestBodyError) {
      return c.json(
        anthropicErrorBody(
          error.message,
          requestId,
          error.status === 413 ? "request_too_large" : "invalid_request_error",
        ),
        error.status,
      );
    }
    return c.json(anthropicErrorBody("invalid JSON body", requestId), 400);
  }

  const validationError = validateAnthropicMessageRequestShape(body);
  if (validationError) {
    return c.json(anthropicErrorBody(validationError, requestId), 400);
  }
  return { body: body as T, rawBody };
}

async function modelAccessError(
  c: Context,
  model: string,
  resolveAccessModel: (model: string) => Promise<string>,
): Promise<Response | null> {
  try {
    const accessModelId = await resolveAccessModel(model);
    assertApiKeyModelAllowed(accessModelId, readApiKeyModelAccess(c));
    return null;
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json(
        anthropicErrorBody(error.message, requestIdFromHono(c), "permission_error"),
        403,
      );
    }
    throw error;
  }
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

async function enforceMessagesRateLimit(c: Context, next: () => Promise<void>) {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  try {
    await checkMessagesRateLimit(apiKeyId, messagesRelayConfig);
  } catch (error) {
    if (error instanceof MessagesRateLimitExceededError) {
      c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json(
        anthropicErrorBody(error.message, requestIdFromHono(c), "rate_limit_error"),
        429,
      );
    }
    if (error instanceof MessagesRateLimitUnavailableError) {
      return c.json(anthropicErrorBody(error.message, requestIdFromHono(c), "api_error"), 503);
    }
    throw error;
  }
  await next();
}

async function safeRecordMessagesSuccess(c: Context) {
  try {
    await recordMessagesRateLimitSuccess(c.get("apiKeyId" as never) as string, messagesRelayConfig);
  } catch (error) {
    console.error("anthropic_messages_rate_limit_success_record_failed", {
      requestId: requestIdFromHono(c),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function messagesErrorResponse(c: Context, error: unknown): Response {
  const requestId = requestIdFromHono(c);
  if (
    error instanceof MessagesRelayClientAbortError ||
    error instanceof MessagesRelayTimeoutError ||
    error instanceof MessagesRelayProtocolError ||
    error instanceof TypeError ||
    error instanceof UpstreamAnthropicMessagesApiError
  ) {
    const sanitized = anthropicRelayError(error, requestId);
    if (sanitized.retryAfter) c.header("Retry-After", sanitized.retryAfter);
    return c.json(sanitized.body, sanitized.status as 400);
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  if (message.startsWith("No provider found")) {
    return c.json(anthropicErrorBody(message, requestId, "not_found_error"), 404);
  }
  if (
    error instanceof ApiKeySpendLimitExceededError ||
    error instanceof ApiKeyUnbillableAnthropicMessageUsageError
  ) {
    return c.json(anthropicErrorBody(message, requestId, "rate_limit_error"), 429);
  }
  if (error instanceof ApiKeyModelAccessDeniedError) {
    return c.json(anthropicErrorBody(message, requestId, "permission_error"), 403);
  }
  if (error instanceof ChannelParamOverrideError) {
    return c.json(
      anthropicErrorBody(error.message, requestId, error.type || "invalid_request_error"),
      error.statusCode as 400,
    );
  }
  if (error instanceof ChannelHeaderOverrideError) {
    return c.json(anthropicErrorBody(error.message, requestId), 400);
  }
  if (
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError ||
    error instanceof MessagesRateLimitUnavailableError
  ) {
    return c.json(anthropicErrorBody(message, requestId, "api_error"), 503);
  }

  console.error("anthropic_messages_request_failed", { requestId, error: message });
  return c.json(anthropicErrorBody("Internal server error", requestId, "api_error"), 500);
}

function providerOptionsFromHono(c: Context) {
  const headers: Record<string, string> = {
    "anthropic-version": c.req.header("anthropic-version")?.trim() || "2023-06-01",
  };
  const anthropicBeta = c.req.header("anthropic-beta")?.trim();
  if (anthropicBeta) headers["anthropic-beta"] = anthropicBeta;
  const betaQuery = c.req.query("beta")?.trim();
  return {
    headers,
    ...(betaQuery === "true" ? { query: { beta: "true" } } : {}),
  };
}

function requestContextFromHono(c: Context) {
  return {
    clientHeaders: c.req.raw.headers,
    requestPath: new URL(c.req.url).pathname,
  };
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

function requestIdFromHono(c: Context): string {
  return c.get("requestId" as never) as string;
}

function logSettlementFailure(c: Context, error: unknown) {
  console.error("anthropic_messages_spend_settlement_failed", {
    requestId: requestIdFromHono(c),
    error: error instanceof Error ? error.message : String(error),
  });
}

function validateAnthropicMessageRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "request body must be an object";
  }
  const request = value as Partial<AnthropicMessageCreateRequest>;
  if (typeof request.model !== "string" || request.model.trim().length === 0) {
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

class AnthropicSseTracker {
  private buffer = "";
  private promptTokens: number | undefined;
  private completionTokens: number | undefined;
  private cacheCreationTokens: number | undefined;
  private cacheReadTokens: number | undefined;
  outputTokenEstimate = 0;
  terminal = false;
  terminalError: string | undefined;

  push(chunk: string, requestId: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";
    return blocks.map((block) => this.readBlock(block, requestId));
  }

  end(requestId: string): string[] {
    const output = this.buffer.trim() ? [this.readBlock(this.buffer, requestId)] : [];
    this.buffer = "";
    return output;
  }

  usage(): {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    pricingInputTokens?: number;
  } {
    const totalTokens =
      this.promptTokens === undefined && this.completionTokens === undefined
        ? undefined
        : (this.promptTokens ?? 0) + (this.completionTokens ?? 0);
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens,
      pricingInputTokens:
        this.promptTokens === undefined &&
        this.cacheCreationTokens === undefined &&
        this.cacheReadTokens === undefined
          ? undefined
          : (this.promptTokens ?? 0) +
            (this.cacheCreationTokens ?? 0) +
            (this.cacheReadTokens ?? 0),
    };
  }

  private readBlock(block: string, requestId: string): string {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return `${block}\n\n`;

    try {
      const event = JSON.parse(data) as {
        type?: string;
        error?: { message?: unknown };
        message?: { usage?: Record<string, unknown> };
        usage?: Record<string, unknown>;
      };
      this.outputTokenEstimate += estimateAnthropicStreamOutputTokens(event);
      if (event.type === "message_stop") this.terminal = true;
      if (event.type === "error") {
        this.terminal = true;
        this.terminalError = "Upstream stream error";
        const sanitized = anthropicRelayError(
          new UpstreamAnthropicMessagesApiError(502, JSON.stringify(event), "application/json"),
          requestId,
        );
        return `event: error\ndata: ${JSON.stringify(sanitized.body)}\n\n`;
      }
      const usage = event.message?.usage ?? event.usage;
      if (usage) {
        this.promptTokens = finiteNumber(usage.input_tokens) ?? this.promptTokens;
        this.completionTokens = finiteNumber(usage.output_tokens) ?? this.completionTokens;
        this.cacheCreationTokens =
          finiteNumber(usage.cache_creation_input_tokens) ?? this.cacheCreationTokens;
        this.cacheReadTokens = finiteNumber(usage.cache_read_input_tokens) ?? this.cacheReadTokens;
      }
    } catch {
      // Unknown SSE events are forwarded unchanged and do not affect accounting.
    }
    return `${block}\n\n`;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
