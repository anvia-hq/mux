import { randomUUID } from "node:crypto";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../../providers/types";
import {
  estimateCost,
  getModelPricing,
  resolveChatModel,
  type ResolvedProviderModel,
} from "../../providers/registry";
import {
  assertChatFeaturesSupported,
  requestedChatFeatures,
  UnsupportedChatFeatureError,
} from "../../providers/chat-compat";
import { prepareChannelChatRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import { logRequest } from "../../middleware/logger";
import { addApiKeySpendUsd } from "../keys/services";
import {
  expandChatSpendReservation,
  refundChatSpendReservation,
  reserveChatSpend,
  settleChatSpendReservation,
  type ChatSpendLimits,
  type ChatSpendReservation,
} from "./relay/billing";
import { chatRelayConfig, type ChatRelayConfig } from "./relay/config";
import {
  ChatRelayClientAbortError,
  ChatRelayProtocolError,
  ChatRelayTimeoutError,
  internalRelayErrorMessage,
  isRetryableRelayError,
  relayErrorStatus,
} from "./relay/errors";
import { createChatCandidateSelector } from "./relay/routing";
import {
  estimateChatChunkTokens,
  estimateChatInputTokens,
  estimateChatOutputTokens,
  requestedOutputTokenLimit,
} from "./relay/token-estimator";

export type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  pricing_input_tokens?: number;
};

export type ChatCompletionResult =
  | {
      kind: "stream";
      stream: AsyncIterable<ChatCompletionChunk>;
      provider: string;
      model: string;
      channelId?: string;
      channelName?: string;
      latencyMs: number;
      responseModel: string;
      abort: () => void;
      finalizeSpend: (usage?: ChatCompletionUsage) => Promise<number | undefined>;
    }
  | {
      kind: "complete";
      response: ChatCompletionResponse;
    };

export class ApiKeyUnbillableUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableUsageError";
  }
}

export type HandleChatCompletionOptions = {
  requireBillableUsage?: boolean;
  billing?: ChatSpendLimits;
  requestContext?: ChannelOverrideRequestContext;
  rawBody?: string;
  requestId?: string;
  signal?: AbortSignal;
  config?: ChatRelayConfig;
  random?: () => number;
};

export async function handleChatCompletion(
  request: ChatCompletionRequest,
  apiKeyId: string,
  options: HandleChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const config = options.config ?? chatRelayConfig;
  const requestId = options.requestId ?? randomUUID();
  const resolved = await resolveChatModel(request.model);
  if (!resolved) throw new Error(`No provider found for model: ${request.model}`);

  const compatibleTargets = compatibleTargetsForRequest(
    request,
    resolved.targets,
    resolved.kind === "direct",
  );
  const targets = options.requireBillableUsage
    ? compatibleTargets.filter((target) => getModelPricing(target.publicModelId))
    : compatibleTargets;
  if (targets.length === 0 && options.requireBillableUsage) {
    throw new ApiKeyUnbillableUsageError();
  }

  const selector = createChatCandidateSelector(targets, options.random);
  const estimatedPromptTokens = estimateChatInputTokens(request);
  const prechargePromptTokens = Math.max(estimatedPromptTokens, 500);
  const requestedOutputTokens = requestedOutputTokenLimit(request);
  let reservation: ChatSpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    let attemptStartedAt: number | undefined;

    try {
      if (options.billing) {
        const liability = estimateCost(
          target.publicModelId,
          prechargePromptTokens,
          requestedOutputTokens,
        );
        if (liability === undefined || liability <= 0) throw new ApiKeyUnbillableUsageError();
        if (!reservation) {
          reservation = await reserveChatSpend(options.billing, requestId, liability);
        } else {
          await expandChatSpendReservation(reservation, liability);
        }
      }

      if (request.stream) {
        attemptStartedAt = Date.now();
        const selected = await startStreamingAttempt(
          request,
          target,
          options.requestContext,
          options.rawBody,
          options.signal,
          config,
        );
        let streamedCompletionTokens = 0;
        let spendFinalized = false;
        return {
          kind: "stream",
          stream: prefixStreamModel(selected.stream, resolved.requestedModelId, (chunk) => {
            streamedCompletionTokens += estimateChatChunkTokens(chunk);
          }),
          provider: target.providerName,
          model: target.publicModelId,
          channelId: target.channelId,
          channelName: target.channelName,
          responseModel: resolved.requestedModelId,
          latencyMs: selected.latencyMs,
          abort: selected.abort,
          finalizeSpend: async (usage) => {
            const actualCost = estimateCost(
              target.publicModelId,
              usage?.prompt_tokens ?? estimatedPromptTokens,
              usage?.completion_tokens ?? streamedCompletionTokens,
              undefined,
              usage?.pricing_input_tokens,
            );
            if (!spendFinalized) {
              spendFinalized = true;
              await settleChatSpendReservation(reservation, actualCost);
            }
            return actualCost ?? reservation?.reservedUsd;
          },
        };
      }

      attemptStartedAt = Date.now();
      const response = await runNonStreamingAttempt(
        request,
        target,
        options.requestContext,
        options.rawBody,
        options.signal,
        config,
      );
      const latencyMs = Date.now() - attemptStartedAt;
      const actualCost = estimateCost(
        target.publicModelId,
        response.usage?.prompt_tokens ?? estimatedPromptTokens,
        response.usage?.completion_tokens ?? estimateChatOutputTokens(response),
        undefined,
        response.usage?.pricing_input_tokens,
      );
      if (options.requireBillableUsage && !options.billing) {
        if (actualCost === undefined) throw new ApiKeyUnbillableUsageError();
        await addApiKeySpendUsd(apiKeyId, actualCost);
      }
      try {
        await settleChatSpendReservation(reservation, actualCost);
      } catch (settlementError) {
        console.error("chat_spend_settlement_failed", {
          requestId,
          error: internalRelayErrorMessage(settlementError),
        });
      }
      await safeLogRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: resolved.requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/chat/completions",
        latencyMs,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        pricingInputTokens: response.usage?.pricing_input_tokens,
        estimatedCost: actualCost,
        statusCode: 200,
      });
      return { kind: "complete", response: { ...response, model: resolved.requestedModelId } };
    } catch (error) {
      if (
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError ||
        error instanceof ApiKeyUnbillableUsageError ||
        isSpendControlError(error)
      ) {
        await safeRefund(reservation, requestId);
        throw error;
      }

      const relayError =
        error instanceof SyntaxError
          ? new ChatRelayProtocolError("Upstream returned malformed JSON")
          : error;
      lastError = relayError;
      await safeLogRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: resolved.requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/chat/completions",
        latencyMs: attemptStartedAt === undefined ? 0 : Date.now() - attemptStartedAt,
        statusCode: relayErrorStatus(relayError),
        errorMessage: internalRelayErrorMessage(relayError),
      });

      if (
        attempt >= config.retryCount ||
        !isRetryableRelayError(relayError, config, options.signal)
      ) {
        break;
      }
    }
  }

  await safeRefund(reservation, requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

function compatibleTargetsForRequest(
  request: ChatCompletionRequest,
  targets: ResolvedProviderModel[],
  throwForFirstTarget: boolean,
): ResolvedProviderModel[] {
  const compatible = targets.filter((target) => {
    const upstreamModelId = target.upstreamModelId ?? target.modelId;
    const model = target.provider
      .listModels()
      .find((candidate) => candidate.id === upstreamModelId);
    if (!model) return false;
    try {
      assertChatFeaturesSupported(
        request,
        model,
        target.publicModelId,
        target.provider.capabilities,
      );
      return true;
    } catch (error) {
      if (throwForFirstTarget && error instanceof UnsupportedChatFeatureError) throw error;
      return false;
    }
  });

  if (compatible.length === 0) {
    throw new UnsupportedChatFeatureError(
      targets[0]?.publicModelId ?? request.model,
      Array.from(requestedChatFeatures(request)),
    );
  }
  return compatible;
}

async function runNonStreamingAttempt(
  request: ChatCompletionRequest,
  target: ResolvedProviderModel,
  context: ChannelOverrideRequestContext | undefined,
  rawBody: string | undefined,
  parentSignal: AbortSignal | undefined,
  config: ChatRelayConfig,
): Promise<ChatCompletionResponse> {
  const attempt = attemptSignal(parentSignal);
  const prepared = prepareChannelChatRequestSettings(
    { ...request, model: target.upstreamModelId ?? target.modelId },
    target,
    targetRequestContext(request, target, context),
  );
  const providerOptions = providerRequestOptions(
    prepared.headers,
    rawPassThroughBody(target, rawBody),
    attempt.controller.signal,
  );
  try {
    return await raceWithTimeout(
      target.provider.chatCompletion(prepared.body, providerOptions),
      config.nonStreamTimeoutMs,
      "non_stream",
      attempt.controller,
      parentSignal,
    );
  } finally {
    attempt.cleanup();
  }
}

async function startStreamingAttempt(
  request: ChatCompletionRequest,
  target: ResolvedProviderModel,
  context: ChannelOverrideRequestContext | undefined,
  rawBody: string | undefined,
  parentSignal: AbortSignal | undefined,
  config: ChatRelayConfig,
): Promise<{ stream: AsyncIterable<ChatCompletionChunk>; latencyMs: number; abort: () => void }> {
  const attempt = attemptSignal(parentSignal);
  const prepared = prepareChannelChatRequestSettings(
    { ...request, model: target.upstreamModelId ?? target.modelId },
    target,
    targetRequestContext(request, target, context),
  );
  const providerOptions = providerRequestOptions(
    prepared.headers,
    rawPassThroughBody(target, rawBody),
    attempt.controller.signal,
  );
  const startedAt = Date.now();
  let iterator: AsyncIterator<ChatCompletionChunk> | undefined;

  try {
    const source = target.provider.chatCompletionStream(prepared.body, providerOptions);
    iterator = source[Symbol.asyncIterator]();
    const first = await raceWithTimeout(
      iterator.next(),
      config.firstByteTimeoutMs,
      "first_byte",
      attempt.controller,
      parentSignal,
    );
    if (first.done)
      throw new ChatRelayProtocolError("Upstream stream ended before its first event");
    return {
      latencyMs: Date.now() - startedAt,
      abort: () => attempt.controller.abort(new ChatRelayClientAbortError()),
      stream: streamWithIdleTimeout(
        first.value,
        iterator,
        attempt.controller,
        attempt.cleanup,
        parentSignal,
        config.streamIdleTimeoutMs,
      ),
    };
  } catch (error) {
    attempt.cleanup();
    attempt.controller.abort(error);
    closeIterator(iterator);
    throw error;
  }
}

async function* streamWithIdleTimeout(
  first: ChatCompletionChunk,
  iterator: AsyncIterator<ChatCompletionChunk>,
  controller: AbortController,
  cleanup: () => void,
  parentSignal: AbortSignal | undefined,
  idleTimeoutMs: number,
): AsyncIterable<ChatCompletionChunk> {
  try {
    yield first;
    while (true) {
      const next = await raceWithTimeout(
        iterator.next(),
        idleTimeoutMs,
        "idle",
        controller,
        parentSignal,
      );
      if (next.done) return;
      yield next.value;
    }
  } finally {
    cleanup();
    controller.abort(new ChatRelayClientAbortError());
    closeIterator(iterator);
  }
}

function closeIterator(iterator: AsyncIterator<ChatCompletionChunk> | undefined): void {
  try {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
  } catch {
    // The stream's primary result has already been surfaced to the caller.
  }
}

function attemptSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(new ChatRelayClientAbortError());
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  return {
    controller,
    cleanup: () => parentSignal?.removeEventListener("abort", abortFromParent),
  };
}

async function raceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  phase: "first_byte" | "idle" | "non_stream",
  controller: AbortController,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new ChatRelayClientAbortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortFromParent: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ChatRelayTimeoutError(phase);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const clientAbort = new Promise<never>((_, reject) => {
    if (!parentSignal) return;
    abortFromParent = () => reject(new ChatRelayClientAbortError());
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, clientAbort]);
  } catch (error) {
    if (parentSignal?.aborted) throw new ChatRelayClientAbortError();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (abortFromParent) parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function targetRequestContext(
  request: ChatCompletionRequest,
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

function providerRequestOptions(
  headers: Record<string, string>,
  rawBody: string | undefined,
  signal: AbortSignal,
) {
  return {
    headers,
    signal,
    ...(rawBody !== undefined ? { rawBody } : {}),
  };
}

function rawPassThroughBody(target: ResolvedProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}

async function* prefixStreamModel(
  stream: AsyncIterable<ChatCompletionChunk>,
  publicModelId: string,
  observe: (chunk: ChatCompletionChunk) => void,
): AsyncIterable<ChatCompletionChunk> {
  for await (const chunk of stream) {
    observe(chunk);
    yield { ...chunk, model: publicModelId };
  }
}

async function safeRefund(reservation: ChatSpendReservation | null, requestId: string) {
  try {
    await refundChatSpendReservation(reservation);
  } catch (error) {
    console.error("chat_spend_refund_failed", {
      requestId,
      error: internalRelayErrorMessage(error),
    });
  }
}

async function safeLogRequest(entry: Parameters<typeof logRequest>[0]) {
  try {
    await logRequest(entry);
  } catch (error) {
    console.error("chat_request_log_failed", {
      error: internalRelayErrorMessage(error),
    });
  }
}

function isSpendControlError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["ApiKeySpendLimitExceededError", "ApiKeySpendLedgerUnavailableError"].includes(error.name)
  );
}
