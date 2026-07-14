import { randomUUID } from "node:crypto";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { UpstreamAnthropicMessagesApiError } from "../../providers/anthropic";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  estimateCost,
  getModelPricing,
  resolveAnthropicMessageTokenCountModel,
  resolveAnthropicMessagesModel,
  type ResolvedAnthropicMessageTokenCountProviderModel,
  type ResolvedAnthropicMessagesProviderModel,
  type ResolvedProviderModel,
} from "../../providers/registry";
import type {
  AnthropicMessageCountTokensRequest,
  AnthropicMessageCreateRequest,
  AnthropicMessageObject,
  AnthropicMessageTokenCountObject,
  ProviderRequestOptions,
} from "../../providers/types";
import { mergeProviderRequestHeaders } from "../../providers/types";
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
import { messagesRelayConfig, type MessagesRelayConfig } from "./relay/config";
import {
  MessagesRelayClientAbortError,
  MessagesRelayProtocolError,
  MessagesRelayTimeoutError,
  messagesRelayStatus,
  retryableMessagesError,
} from "./relay/errors";
import { estimateAnthropicMessageInputTokens } from "./relay/token-estimator";

type AnthropicUsage = ReturnType<typeof extractAnthropicMessageTokenUsage>;

export type AnthropicMessageResult =
  | {
      kind: "stream";
      stream: AsyncIterable<string>;
      provider: string;
      model: string;
      channelId?: string;
      channelName?: string;
      latencyMs: number;
      status: number;
      headers: Headers;
      abort: () => void;
      refundSpend: () => Promise<void>;
      finalizeSpend: (
        usage?: AnthropicUsage,
        outputTokenEstimate?: number,
      ) => Promise<number | undefined>;
    }
  | {
      kind: "complete";
      response: AnthropicMessageObject;
      status: number;
      headers: Headers;
    };

export type AnthropicMessageTokenCountResult = {
  provider: string;
  model: string;
  channelId?: string;
  channelName?: string;
  response: AnthropicMessageTokenCountObject;
  status: number;
  headers: Headers;
};

export type HandleAnthropicMessageOptions = {
  requireBillableUsage?: boolean;
  billing?: SpendLimits;
  providerOptions?: ProviderRequestOptions;
  requestContext?: ChannelOverrideRequestContext;
  rawBody?: string;
  requestId?: string;
  signal?: AbortSignal;
  config?: MessagesRelayConfig;
  random?: () => number;
};

export class ApiKeyUnbillableAnthropicMessageUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableAnthropicMessageUsageError";
  }
}

export async function handleAnthropicMessage(
  request: AnthropicMessageCreateRequest,
  apiKeyId: string,
  options: HandleAnthropicMessageOptions = {},
): Promise<AnthropicMessageResult> {
  const resolved = await resolveAnthropicMessagesModel(request.model);
  if (!resolved) throw new Error(`No provider found for model: ${request.model}`);

  const targets = options.requireBillableUsage
    ? resolved.targets.filter((target) => getModelPricing(target.publicModelId))
    : resolved.targets;
  if (targets.length === 0 && options.requireBillableUsage) {
    throw new ApiKeyUnbillableAnthropicMessageUsageError();
  }

  return request.stream === true
    ? createAnthropicMessageStreamWithFallback(
        request,
        apiKeyId,
        resolved.requestedModelId,
        targets,
        options,
      )
    : createAnthropicMessageWithFallback(
        request,
        apiKeyId,
        resolved.requestedModelId,
        targets,
        options,
      );
}

export async function handleAnthropicMessageTokenCount(
  request: AnthropicMessageCountTokensRequest,
  apiKeyId: string,
  options: Omit<HandleAnthropicMessageOptions, "requireBillableUsage" | "billing"> = {},
): Promise<AnthropicMessageTokenCountResult> {
  const resolved = await resolveAnthropicMessageTokenCountModel(request.model);
  if (!resolved) throw new Error(`No provider found for model: ${request.model}`);

  const config = options.config ?? messagesRelayConfig;
  const selector = createChatCandidateSelector(resolved.targets, options.random);
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next() as ResolvedAnthropicMessageTokenCountProviderModel | null;
    if (!target) break;
    const startedAt = Date.now();
    const attemptSignal = messagesAttemptSignal(options.signal);
    try {
      let status = 200;
      let headers = new Headers();
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        buildAnthropicMessageTokenCountRequest(request, target),
        target,
        targetRequestContext(request, target, options.requestContext),
      );
      const requestOptions = providerRequestOptions(
        options.providerOptions,
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
        attemptSignal.controller.signal,
        (response) => {
          status = response.status;
          headers = new Headers(response.headers);
        },
      );
      const response = await messagesRaceWithTimeout(
        target.provider.countAnthropicMessageTokens(prepared.body, requestOptions),
        config.nonStreamTimeoutMs,
        "non_stream",
        attemptSignal.controller,
        options.signal,
      );
      assertAnthropicTokenCount(response);
      const promptTokens = numberOrUndefined(response.input_tokens);
      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages/count_tokens",
        latencyMs: Date.now() - startedAt,
        promptTokens,
        totalTokens: promptTokens,
        statusCode: status,
      });
      return {
        provider: target.providerName,
        model: resolved.requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        response,
        status,
        headers,
      };
    } catch (error) {
      if (fatalMessagesError(error)) throw error;
      lastError = normalizeMessagesError(error, options.signal, attemptSignal.controller.signal);
      await safeLogAnthropicFailure(
        apiKeyId,
        request.model,
        target,
        "/v1/messages/count_tokens",
        Date.now() - startedAt,
        lastError,
      );
      if (
        attempt >= config.retryCount ||
        !retryableMessagesError(lastError, config, options.signal)
      ) {
        break;
      }
    } finally {
      attemptSignal.cleanup();
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function createAnthropicMessageWithFallback(
  request: AnthropicMessageCreateRequest,
  apiKeyId: string,
  requestedModelId: string,
  targets: ResolvedAnthropicMessagesProviderModel[],
  options: HandleAnthropicMessageOptions,
): Promise<AnthropicMessageResult> {
  const config = options.config ?? messagesRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateAnthropicMessageInputTokens(request);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next() as ResolvedAnthropicMessagesProviderModel | null;
    if (!target) break;
    const startedAt = Date.now();
    try {
      reservation = await reserveForAnthropicAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const result = await runAnthropicMessageAttempt(request, target, options, config);
      assertAnthropicMessage(result.response);
      const usage = extractAnthropicMessageTokenUsage(result.response);
      const estimatedCost = estimateCost(
        target.publicModelId,
        usage.pricingInputTokens ?? usage.promptTokens ?? inputEstimate,
        usage.completionTokens,
        undefined,
        usage.pricingInputTokens,
      );
      if (options.requireBillableUsage && estimatedCost === undefined) {
        throw new ApiKeyUnbillableAnthropicMessageUsageError();
      }
      if (options.requireBillableUsage && !options.billing && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }
      await settleSpendReservation(reservation, estimatedCost);
      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages",
        latencyMs: Date.now() - startedAt,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        pricingInputTokens: usage.pricingInputTokens,
        estimatedCost,
        statusCode: result.status,
      });
      return { kind: "complete", ...result };
    } catch (error) {
      if (fatalMessagesError(error)) {
        await safeRefundAnthropicReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeMessagesError(error, options.signal);
      await safeLogAnthropicFailure(
        apiKeyId,
        requestedModelId,
        target,
        "/v1/messages",
        Date.now() - startedAt,
        lastError,
      );
      if (
        attempt >= config.retryCount ||
        !retryableMessagesError(lastError, config, options.signal)
      ) {
        break;
      }
    }
  }

  await safeRefundAnthropicReservation(reservation, options.requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function createAnthropicMessageStreamWithFallback(
  request: AnthropicMessageCreateRequest,
  apiKeyId: string,
  requestedModelId: string,
  targets: ResolvedAnthropicMessagesProviderModel[],
  options: HandleAnthropicMessageOptions,
): Promise<AnthropicMessageResult> {
  const config = options.config ?? messagesRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateAnthropicMessageInputTokens(request);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next() as ResolvedAnthropicMessagesProviderModel | null;
    if (!target) break;
    const startedAt = Date.now();
    try {
      reservation = await reserveForAnthropicAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const selected = await startAnthropicStreamAttempt(request, target, options, config);
      let finalized = false;
      return {
        kind: "stream",
        stream: selected.stream,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        latencyMs: Date.now() - startedAt,
        status: selected.status,
        headers: selected.headers,
        abort: selected.abort,
        refundSpend: () => safeRefundAnthropicReservation(reservation, options.requestId),
        finalizeSpend: async (usage = {}, outputTokenEstimate = 0) => {
          const estimatedCost = estimateCost(
            target.publicModelId,
            usage.pricingInputTokens ?? usage.promptTokens ?? inputEstimate,
            usage.completionTokens ?? outputTokenEstimate,
            undefined,
            usage.pricingInputTokens,
          );
          if (options.requireBillableUsage && estimatedCost === undefined) {
            throw new ApiKeyUnbillableAnthropicMessageUsageError();
          }
          if (!finalized) {
            finalized = true;
            if (options.requireBillableUsage && !options.billing && estimatedCost !== undefined) {
              await addApiKeySpendUsd(apiKeyId, estimatedCost);
            }
            await settleSpendReservation(reservation, estimatedCost);
          }
          return estimatedCost ?? reservation?.reservedUsd;
        },
      };
    } catch (error) {
      if (fatalMessagesError(error)) {
        await safeRefundAnthropicReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeMessagesError(error, options.signal);
      await safeLogAnthropicFailure(
        apiKeyId,
        requestedModelId,
        target,
        "/v1/messages",
        Date.now() - startedAt,
        lastError,
      );
      if (
        attempt >= config.retryCount ||
        !retryableMessagesError(lastError, config, options.signal)
      ) {
        break;
      }
    }
  }

  await safeRefundAnthropicReservation(reservation, options.requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function runAnthropicMessageAttempt(
  request: AnthropicMessageCreateRequest,
  target: ResolvedAnthropicMessagesProviderModel,
  options: HandleAnthropicMessageOptions,
  config: MessagesRelayConfig,
): Promise<{ response: AnthropicMessageObject; status: number; headers: Headers }> {
  const attempt = messagesAttemptSignal(options.signal);
  let status = 200;
  let headers = new Headers();
  const prepared = prepareChannelOpenAICompatibleRequestSettings(
    buildAnthropicMessageRequest(request, target, false),
    target,
    targetRequestContext(request, target, options.requestContext),
  );
  const requestOptions = providerRequestOptions(
    options.providerOptions,
    prepared.headers,
    rawPassThroughBody(target, options.rawBody),
    attempt.controller.signal,
    (response) => {
      status = response.status;
      headers = new Headers(response.headers);
    },
  );
  try {
    const response = await messagesRaceWithTimeout(
      target.provider.createAnthropicMessage(prepared.body, requestOptions),
      config.nonStreamTimeoutMs,
      "non_stream",
      attempt.controller,
      options.signal,
    );
    return { response, status, headers };
  } catch (error) {
    throw normalizeMessagesError(error, options.signal, attempt.controller.signal);
  } finally {
    attempt.cleanup();
  }
}

async function startAnthropicStreamAttempt(
  request: AnthropicMessageCreateRequest,
  target: ResolvedAnthropicMessagesProviderModel,
  options: HandleAnthropicMessageOptions,
  config: MessagesRelayConfig,
): Promise<{ stream: AsyncIterable<string>; status: number; headers: Headers; abort: () => void }> {
  if (!target.provider.createAnthropicMessageStream) {
    throw new MessagesRelayProtocolError(
      `${target.providerName} does not support Anthropic Messages streaming`,
    );
  }
  const attempt = messagesAttemptSignal(options.signal);
  let status = 200;
  let headers = new Headers();
  const prepared = prepareChannelOpenAICompatibleRequestSettings(
    buildAnthropicMessageRequest(request, target, true),
    target,
    targetRequestContext(request, target, options.requestContext),
  );
  const requestOptions = providerRequestOptions(
    options.providerOptions,
    prepared.headers,
    rawPassThroughBody(target, options.rawBody),
    attempt.controller.signal,
    (response) => {
      status = response.status;
      headers = new Headers(response.headers);
    },
  );
  let iterator: AsyncIterator<string> | undefined;
  try {
    iterator = target.provider
      .createAnthropicMessageStream(prepared.body, requestOptions)
      [Symbol.asyncIterator]();
    const first = await messagesRaceWithTimeout(
      iterator.next(),
      config.firstByteTimeoutMs,
      "first_byte",
      attempt.controller,
      options.signal,
    );
    if (first.done) {
      throw new MessagesRelayProtocolError("Upstream stream ended before its first event");
    }
    return {
      status,
      headers,
      abort: () => attempt.controller.abort(new MessagesRelayClientAbortError()),
      stream: anthropicStreamWithIdleTimeout(
        first.value,
        iterator,
        attempt.controller,
        attempt.cleanup,
        options.signal,
        config.streamIdleTimeoutMs,
      ),
    };
  } catch (error) {
    attempt.cleanup();
    attempt.controller.abort(error);
    closeAnthropicIterator(iterator);
    throw normalizeMessagesError(error, options.signal, attempt.controller.signal);
  }
}

async function* anthropicStreamWithIdleTimeout(
  first: string,
  iterator: AsyncIterator<string>,
  controller: AbortController,
  cleanup: () => void,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AsyncIterable<string> {
  try {
    yield first;
    while (true) {
      const next = await messagesRaceWithTimeout(
        iterator.next(),
        timeoutMs,
        "idle",
        controller,
        parentSignal,
      );
      if (next.done) return;
      yield next.value;
    }
  } catch (error) {
    throw normalizeMessagesError(error, parentSignal, controller.signal);
  } finally {
    cleanup();
    controller.abort(new MessagesRelayClientAbortError());
    closeAnthropicIterator(iterator);
  }
}

async function reserveForAnthropicAttempt(
  request: AnthropicMessageCreateRequest,
  target: ResolvedAnthropicMessagesProviderModel,
  billing: SpendLimits | undefined,
  requestId: string | undefined,
  reservation: SpendReservation | null,
  inputEstimate: number,
): Promise<SpendReservation | null> {
  if (!billing) return reservation;
  const pricing = getModelPricing(target.publicModelId);
  if (!pricing) throw new ApiKeyUnbillableAnthropicMessageUsageError();
  const outputTokens = request.max_tokens ?? pricing.maxOutputTokens;
  const liability = estimateCost(
    target.publicModelId,
    Math.max(inputEstimate, 500),
    Math.max(outputTokens, 0),
  );
  if (liability === undefined) throw new ApiKeyUnbillableAnthropicMessageUsageError();
  if (liability <= 0) return reservation;
  if (!reservation) return reserveSpend(billing, requestId ?? randomUUID(), liability);
  await expandSpendReservation(reservation, liability);
  return reservation;
}

function buildAnthropicMessageRequest(
  request: AnthropicMessageCreateRequest,
  target: ResolvedAnthropicMessagesProviderModel,
  stream: boolean,
): AnthropicMessageCreateRequest {
  return {
    ...request,
    model: target.upstreamModelId ?? target.modelId,
    max_tokens:
      request.max_tokens ?? getModelPricing(target.publicModelId)?.maxOutputTokens ?? 4096,
    stream,
  };
}

function buildAnthropicMessageTokenCountRequest(
  request: AnthropicMessageCountTokensRequest,
  target: ResolvedAnthropicMessageTokenCountProviderModel,
): AnthropicMessageCountTokensRequest {
  const body: Record<string, unknown> = {
    ...request,
    model: target.upstreamModelId ?? target.modelId,
  };
  delete body.max_tokens;
  delete body.stream;
  return body as AnthropicMessageCountTokensRequest;
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

function providerRequestOptions(
  baseOptions: ProviderRequestOptions | undefined,
  headers: Record<string, string>,
  rawBody: string | undefined,
  signal: AbortSignal,
  onResponse: (response: Response) => void,
): ProviderRequestOptions {
  const mergedHeaders = mergeProviderRequestHeaders(baseOptions?.headers ?? {}, { headers });
  const {
    headers: _baseHeaders,
    rawBody: _baseRawBody,
    signal: _baseSignal,
    onResponse: _baseOnResponse,
    ...remainingBaseOptions
  } = baseOptions ?? {};
  return {
    ...remainingBaseOptions,
    headers: mergedHeaders,
    ...(rawBody !== undefined ? { rawBody } : {}),
    signal,
    onResponse: (response) => {
      baseOptions?.onResponse?.(response);
      onResponse(response);
    },
  };
}

function rawPassThroughBody(target: ResolvedProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}

function messagesAttemptSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(new MessagesRelayClientAbortError());
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  return { controller, cleanup: () => parentSignal?.removeEventListener("abort", abort) };
}

async function messagesRaceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  phase: "first_byte" | "idle" | "non_stream",
  controller: AbortController,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new MessagesRelayClientAbortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new MessagesRelayTimeoutError(phase);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!parentSignal) return;
    abortListener = () => reject(new MessagesRelayClientAbortError());
    parentSignal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) parentSignal?.removeEventListener("abort", abortListener);
  }
}

function closeAnthropicIterator(iterator: AsyncIterator<string> | undefined) {
  try {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
  } catch {
    // The primary stream result is already being surfaced.
  }
}

function normalizeMessagesError(
  error: unknown,
  parentSignal?: AbortSignal,
  attemptSignal?: AbortSignal,
): unknown {
  if (parentSignal?.aborted) return new MessagesRelayClientAbortError();
  if (
    attemptSignal?.reason instanceof MessagesRelayClientAbortError ||
    attemptSignal?.reason instanceof MessagesRelayTimeoutError
  ) {
    return attemptSignal.reason;
  }
  if (error instanceof SyntaxError) {
    return new MessagesRelayProtocolError("Upstream returned malformed JSON");
  }
  if (
    error instanceof UpstreamAnthropicMessagesApiError ||
    error instanceof MessagesRelayClientAbortError ||
    error instanceof MessagesRelayTimeoutError ||
    error instanceof MessagesRelayProtocolError
  ) {
    return error;
  }
  return new MessagesRelayProtocolError("Upstream request failed");
}

function fatalMessagesError(error: unknown): boolean {
  return (
    error instanceof ChannelParamOverrideError ||
    error instanceof ChannelHeaderOverrideError ||
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError ||
    error instanceof ApiKeySpendLimitExceededError ||
    error instanceof ApiKeyUnbillableAnthropicMessageUsageError
  );
}

async function safeRefundAnthropicReservation(
  reservation: SpendReservation | null,
  requestId?: string,
): Promise<void> {
  try {
    await refundSpendReservation(reservation);
  } catch (error) {
    console.error("anthropic_messages_spend_refund_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeLogAnthropicFailure(
  apiKeyId: string,
  requestedModel: string,
  target: ResolvedProviderModel,
  endpoint: string,
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
      endpoint,
      latencyMs,
      statusCode: messagesRelayStatus(error),
      errorMessage:
        error instanceof UpstreamAnthropicMessagesApiError
          ? `Anthropic upstream error (status ${error.status})`
          : error instanceof Error
            ? error.message
            : "Upstream request failed",
    });
  } catch (loggingError) {
    if (loggingError instanceof RequestLoggingUnavailableError) throw loggingError;
  }
}

function assertAnthropicMessage(response: AnthropicMessageObject): void {
  const value = response as Record<string, unknown>;
  if (value.error && typeof value.id !== "string") {
    throw new MessagesRelayProtocolError("Upstream returned an error envelope with HTTP 200");
  }
  if (typeof value.id !== "string" || !Array.isArray(value.content)) {
    throw new MessagesRelayProtocolError("Upstream returned a malformed Message object");
  }
}

function assertAnthropicTokenCount(response: AnthropicMessageTokenCountObject): void {
  if (numberOrUndefined(response.input_tokens) === undefined) {
    throw new MessagesRelayProtocolError("Upstream returned a malformed token count object");
  }
}

export function extractAnthropicMessageTokenUsage(response: AnthropicMessageObject): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  pricingInputTokens?: number;
} {
  const usage = response.usage;
  if (!usage) return {};

  const promptTokens = numberOrUndefined(usage.input_tokens);
  const completionTokens = numberOrUndefined(usage.output_tokens);
  const cacheCreationTokens = numberOrUndefined(usage.cache_creation_input_tokens);
  const cacheReadTokens = numberOrUndefined(usage.cache_read_input_tokens);
  const pricingInputTokens =
    promptTokens === undefined && cacheCreationTokens === undefined && cacheReadTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0);
  const totalTokens =
    promptTokens === undefined && completionTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (completionTokens ?? 0);

  return { promptTokens, completionTokens, totalTokens, pricingInputTokens };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
