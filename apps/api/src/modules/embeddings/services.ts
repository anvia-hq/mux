import { randomUUID } from "node:crypto";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import { UpstreamOpenAICompatibleError } from "../../providers/openai-compatible-error";
import {
  estimateCost,
  getModelPricing,
  resolveEmbeddingModel,
  type ResolvedEmbeddingProviderModel,
  type ResolvedProviderModel,
} from "../../providers/registry";
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderRequestOptions,
} from "../../providers/types";
import {
  addApiKeySpendUsd,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
} from "../keys/services";
import {
  expandSpendReservation,
  refundSpendReservation,
  reserveSpend,
  settleSpendReservation,
  type SpendLimits,
  type SpendReservation,
} from "../relay/billing";
import { createChatCandidateSelector } from "../chat/relay/routing";
import { embeddingsRelayConfig, type EmbeddingsRelayConfig } from "./relay/config";
import {
  EmbeddingsRelayClientAbortError,
  EmbeddingsRelayProtocolError,
  EmbeddingsRelayTimeoutError,
  embeddingsRelayStatus,
  retryableEmbeddingsError,
} from "./relay/errors";
import { estimateEmbeddingInputTokens } from "./relay/token-estimator";

export class ApiKeyUnbillableEmbeddingUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableEmbeddingUsageError";
  }
}

export type EmbeddingCreateResult = {
  response: EmbeddingResponse;
  status: number;
  headers: Headers;
};

export type HandleEmbeddingOptions = {
  requireBillableUsage?: boolean;
  billing?: SpendLimits;
  requestContext?: ChannelOverrideRequestContext;
  rawBody?: string;
  requestId?: string;
  signal?: AbortSignal;
  config?: EmbeddingsRelayConfig;
  random?: () => number;
};

export async function handleEmbedding(
  request: EmbeddingRequest,
  apiKeyId: string,
  options: HandleEmbeddingOptions = {},
): Promise<EmbeddingCreateResult> {
  const resolved = await resolveEmbeddingModel(request.model);
  if (!resolved) throw new Error(`No provider found for model: ${request.model}`);

  const targets = options.requireBillableUsage
    ? resolved.targets.filter((target) => getModelPricing(target.publicModelId))
    : resolved.targets;
  if (targets.length === 0 && options.requireBillableUsage) {
    throw new ApiKeyUnbillableEmbeddingUsageError();
  }

  const config = options.config ?? embeddingsRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateEmbeddingInputTokens(request.input);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next() as ResolvedEmbeddingProviderModel | null;
    if (!target) break;
    const startedAt = Date.now();
    try {
      reservation = await reserveForEmbeddingAttempt(
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const result = await runEmbeddingAttempt(request, target, options, config);
      assertEmbeddingResponse(result.response, request.encoding_format);
      const response: EmbeddingResponse = {
        ...result.response,
        model: resolved.requestedModelId,
      };
      const promptTokens = response.usage?.prompt_tokens ?? inputEstimate;
      const actualCost = estimateCost(target.publicModelId, promptTokens, 0);
      if (options.requireBillableUsage && actualCost === undefined) {
        throw new ApiKeyUnbillableEmbeddingUsageError();
      }
      if (options.requireBillableUsage && !options.billing && actualCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, actualCost);
      }
      await settleSpendReservation(reservation, actualCost);
      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: resolved.requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/embeddings",
        latencyMs: Date.now() - startedAt,
        promptTokens,
        totalTokens: response.usage?.total_tokens ?? promptTokens,
        estimatedCost: actualCost,
        statusCode: result.status,
      });
      return { response, status: result.status, headers: result.headers };
    } catch (error) {
      if (fatalEmbeddingError(error)) {
        await safeRefundEmbeddingReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeEmbeddingError(error, options.signal);
      try {
        await safeLogEmbeddingFailure(
          apiKeyId,
          resolved.requestedModelId,
          target,
          Date.now() - startedAt,
          lastError,
        );
      } catch (loggingError) {
        await safeRefundEmbeddingReservation(reservation, options.requestId);
        throw loggingError;
      }
      if (
        attempt >= config.retryCount ||
        !retryableEmbeddingsError(lastError, config, options.signal)
      ) {
        break;
      }
    }
  }

  await safeRefundEmbeddingReservation(reservation, options.requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function reserveForEmbeddingAttempt(
  target: ResolvedEmbeddingProviderModel,
  billing: SpendLimits | undefined,
  requestId: string | undefined,
  reservation: SpendReservation | null,
  inputEstimate: number,
): Promise<SpendReservation | null> {
  if (!billing) return reservation;
  if (!getModelPricing(target.publicModelId)) {
    throw new ApiKeyUnbillableEmbeddingUsageError();
  }
  const liability = estimateCost(target.publicModelId, Math.max(inputEstimate, 1), 0);
  if (liability === undefined) throw new ApiKeyUnbillableEmbeddingUsageError();
  if (liability <= 0) return reservation;
  if (!reservation) return reserveSpend(billing, requestId ?? randomUUID(), liability);
  await expandSpendReservation(reservation, liability);
  return reservation;
}

async function runEmbeddingAttempt(
  request: EmbeddingRequest,
  target: ResolvedEmbeddingProviderModel,
  options: HandleEmbeddingOptions,
  config: EmbeddingsRelayConfig,
): Promise<EmbeddingCreateResult> {
  const attempt = embeddingAttemptSignal(options.signal);
  let status = 200;
  let headers = new Headers();
  const prepared = prepareChannelOpenAICompatibleRequestSettings(
    { ...request, model: target.upstreamModelId ?? target.modelId },
    target,
    targetRequestContext(request, target, options.requestContext),
  );
  const rawBody = rawPassThroughBody(target, options.rawBody);
  const providerOptions: ProviderRequestOptions = {
    headers: prepared.headers,
    ...(rawBody !== undefined ? { rawBody } : {}),
    signal: attempt.controller.signal,
    onResponse: (response) => {
      status = response.status;
      headers = new Headers(response.headers);
    },
  };

  try {
    const response = await embeddingRaceWithTimeout(
      target.provider.createEmbedding(prepared.body, providerOptions),
      config.nonStreamTimeoutMs,
      attempt.controller,
      options.signal,
    );
    return { response, status, headers };
  } catch (error) {
    throw normalizeEmbeddingError(error, options.signal, attempt.controller.signal);
  } finally {
    attempt.cleanup();
  }
}

function assertEmbeddingResponse(
  response: EmbeddingResponse,
  encodingFormat: EmbeddingRequest["encoding_format"],
): void {
  const value = response as unknown as Record<string, unknown>;
  if (value.error) {
    throw new EmbeddingsRelayProtocolError("Upstream returned an error envelope with HTTP 200");
  }
  if (value.object !== "list" || typeof value.model !== "string" || !Array.isArray(value.data)) {
    throw new EmbeddingsRelayProtocolError("Upstream returned a malformed embedding response");
  }
  const expectsBase64 = encodingFormat === "base64";
  for (const item of value.data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new EmbeddingsRelayProtocolError("Upstream returned a malformed embedding item");
    }
    const embedding = item as Record<string, unknown>;
    const validVector =
      Array.isArray(embedding.embedding) &&
      embedding.embedding.length > 0 &&
      embedding.embedding.every((number) => typeof number === "number" && Number.isFinite(number));
    if (
      embedding.object !== "embedding" ||
      typeof embedding.index !== "number" ||
      !Number.isInteger(embedding.index) ||
      embedding.index < 0 ||
      (expectsBase64
        ? typeof embedding.embedding !== "string" || embedding.embedding.length === 0
        : !validVector)
    ) {
      throw new EmbeddingsRelayProtocolError("Upstream returned a malformed embedding item");
    }
  }
  if (value.usage !== undefined) {
    const usage = value.usage as Record<string, unknown>;
    for (const field of ["prompt_tokens", "total_tokens"] as const) {
      if (
        !Number.isInteger(usage?.[field]) ||
        typeof usage[field] !== "number" ||
        usage[field] < 0
      ) {
        throw new EmbeddingsRelayProtocolError("Upstream returned malformed embedding usage");
      }
    }
  }
}

function targetRequestContext(
  request: { model: string },
  target: ResolvedProviderModel,
  context: ChannelOverrideRequestContext | undefined,
): ChannelOverrideRequestContext {
  const upstreamModel = target.upstreamModelId ?? target.modelId;
  return {
    ...context,
    apiKey: context?.apiKey ?? target.apiKey,
    originalModel: context?.originalModel ?? request.model,
    upstreamModel: context?.upstreamModel ?? upstreamModel,
  };
}

function rawPassThroughBody(target: ResolvedProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}

function embeddingAttemptSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(new EmbeddingsRelayClientAbortError());
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  return { controller, cleanup: () => parentSignal?.removeEventListener("abort", abort) };
}

async function embeddingRaceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new EmbeddingsRelayClientAbortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new EmbeddingsRelayTimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!parentSignal) return;
    abortListener = () => reject(new EmbeddingsRelayClientAbortError());
    parentSignal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) parentSignal?.removeEventListener("abort", abortListener);
  }
}

function normalizeEmbeddingError(
  error: unknown,
  parentSignal?: AbortSignal,
  attemptSignal?: AbortSignal,
): unknown {
  if (parentSignal?.aborted) return new EmbeddingsRelayClientAbortError();
  if (
    attemptSignal?.reason instanceof EmbeddingsRelayClientAbortError ||
    attemptSignal?.reason instanceof EmbeddingsRelayTimeoutError
  ) {
    return attemptSignal.reason;
  }
  if (error instanceof SyntaxError) {
    return new EmbeddingsRelayProtocolError("Upstream returned malformed JSON");
  }
  if (
    error instanceof UpstreamOpenAICompatibleError ||
    error instanceof EmbeddingsRelayClientAbortError ||
    error instanceof EmbeddingsRelayTimeoutError ||
    error instanceof EmbeddingsRelayProtocolError
  ) {
    return error;
  }
  return new EmbeddingsRelayProtocolError("Upstream request failed");
}

function fatalEmbeddingError(error: unknown): boolean {
  return (
    error instanceof ChannelParamOverrideError ||
    error instanceof ChannelHeaderOverrideError ||
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError ||
    error instanceof ApiKeySpendLimitExceededError ||
    error instanceof ApiKeyUnbillableEmbeddingUsageError
  );
}

async function safeRefundEmbeddingReservation(
  reservation: SpendReservation | null,
  requestId?: string,
): Promise<void> {
  try {
    await refundSpendReservation(reservation);
  } catch (error) {
    console.error("embeddings_spend_refund_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeLogEmbeddingFailure(
  apiKeyId: string,
  requestedModel: string,
  target: ResolvedProviderModel,
  latencyMs: number,
  error: unknown,
) {
  try {
    await logRequest({
      apiKeyId,
      provider: target.providerName,
      model: target.publicModelId,
      requestedModel,
      channelId: target.channelId,
      channelName: target.channelName,
      endpoint: "/v1/embeddings",
      latencyMs,
      statusCode: embeddingsRelayStatus(error),
      errorMessage:
        error instanceof UpstreamOpenAICompatibleError
          ? `Embedding upstream error (status ${error.status})`
          : error instanceof Error
            ? error.message
            : "Upstream request failed",
    });
  } catch (loggingError) {
    if (loggingError instanceof RequestLoggingUnavailableError) throw loggingError;
  }
}
