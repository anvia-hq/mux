import { randomUUID } from "node:crypto";
import { backoffMs, enqueueBackgroundPoll } from "@repo/worker";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import {
  getResponsesCacheTtlSeconds,
  isResponsesCacheEnabled,
  readCachedResponse,
  writeCachedResponse,
} from "../../providers/responses-cache";
import { UpstreamResponsesApiError } from "../../providers/responses-api-error";
import { UpstreamOpenAICompatibleError } from "../../providers/openai-compatible-error";
import {
  estimateCost,
  getModelPricing,
  getProviderByName,
  getProviderChannelRuntime,
  getProviderForChannel,
  listConfiguredProviders,
  resolveChatModel,
  resolveResponseTargets,
  type ResolvedProviderModel,
} from "../../providers/registry";
import {
  prepareChannelCompactRequestSettings,
  prepareChannelResponseRequestSettings,
  type PreparedChannelRequest,
} from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  resolveChannelHeaders,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import type {
  ProviderAdapter,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
} from "../../providers/types";
import {
  chatResponseToResponse,
  chatStreamToResponses,
  responseRequestToChat,
  UnsupportedResponseConversionError,
} from "../../providers/response-chat-converter";
import { prisma } from "../../utils/prisma";
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
import { responsesRelayConfig, type ResponsesRelayConfig } from "./relay/config";
import {
  ResponsesRelayClientAbortError,
  ResponsesRelayProtocolError,
  ResponsesRelayTimeoutError,
  responsesRelayStatus,
  retryableResponsesError,
} from "./relay/errors";
import { estimateResponseInputTokens, estimateResponseOutputTokens } from "./relay/token-estimator";

const RESPONSE_CREATE_FIELDS = [
  "background",
  "conversation",
  "context_management",
  "enable_thinking",
  "include",
  "input",
  "instructions",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "model",
  "parallel_tool_calls",
  "previous_response_id",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_retention",
  "preset",
  "reasoning",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "stream_options",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

const TERMINAL_RESPONSE_STATUSES = new Set(["completed", "cancelled", "failed"]);

export class UnsupportedResponseFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedResponseFeatureError";
  }
}

export class ApiKeyUnbillableResponseUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this response request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableResponseUsageError";
  }
}

export type ResponseStreamResult = {
  stream: AsyncIterable<string>;
  provider: string;
  model: string;
  channelId?: string;
  channelName?: string;
  latencyMs: number;
  status: number;
  headers: Headers;
  abort: () => void;
  finalizeSpend: (
    usage?: ResponseObject["usage"],
    outputTokens?: number,
  ) => Promise<number | undefined>;
};

export type ResponseCreateResult = {
  response: ResponseObject;
  status: number;
  headers: Headers;
};

export type HandleResponseOptions = {
  requireBillableUsage?: boolean;
  billing?: SpendLimits;
  requestContext?: ChannelOverrideRequestContext;
  rawBody?: string;
  requestId?: string;
  signal?: AbortSignal;
  config?: ResponsesRelayConfig;
  random?: () => number;
};

export async function handleResponseCreate(
  request: ResponseCreateRequest,
  apiKeyId: string,
  options: HandleResponseOptions = {},
): Promise<ResponseCreateResult> {
  if (request.stream === true) {
    throw new UnsupportedResponseFeatureError("Responses streaming is not supported yet");
  }

  if (request.background === true) {
    throw new UnsupportedResponseFeatureError(
      "Responses background mode is handled by submitBackgroundResponse, not handleResponseCreate",
    );
  }

  const config = options.config ?? responsesRelayConfig;
  const resolved = await resolveResponseCreateTargets(request, false);
  const targets = options.requireBillableUsage
    ? resolved.targets.filter((target) => getModelPricing(target.publicModelId))
    : resolved.targets;
  if (targets.length === 0 && options.requireBillableUsage)
    throw new ApiKeyUnbillableResponseUsageError();

  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateResponseInputTokens(request);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    const startedAt = Date.now();
    try {
      reservation = await reserveForResponseAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const result = await runResponseAttempt(request, target, options, config);
      assertResponseObject(result.response);
      const response = withPublicModelId(result.response, resolved.requestedModelId);
      const usage = response.usage;
      const actualCost = estimateCost(
        target.publicModelId,
        usage?.input_tokens ?? inputEstimate,
        usage?.output_tokens ?? estimateResponseOutputTokens(response),
        readCachedTokens(usage),
      );
      if (options.requireBillableUsage && actualCost === undefined)
        throw new ApiKeyUnbillableResponseUsageError();
      if (options.requireBillableUsage && !options.billing && actualCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, actualCost);
      }
      await settleSpendReservation(reservation, actualCost);
      await logResponseAttempt(
        apiKeyId,
        resolved.requestedModelId,
        target,
        Date.now() - startedAt,
        result.status,
        response,
        actualCost,
      );
      return { response, status: result.status, headers: result.headers };
    } catch (error) {
      if (fatalResponseError(error)) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeResponseError(error);
      await safeLogResponseFailure(
        apiKeyId,
        resolved.requestedModelId,
        target,
        Date.now() - startedAt,
        lastError,
      );
      if (
        attempt >= config.retryCount ||
        !retryableResponsesError(lastError, config, options.signal)
      )
        break;
    }
  }
  await safeRefundResponseReservation(reservation, options.requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

export async function handleResponseCreateStream(
  request: ResponseCreateRequest,
  apiKeyId: string,
  options: HandleResponseOptions = {},
): Promise<ResponseStreamResult> {
  if (request.background === true) {
    throw new UnsupportedResponseFeatureError(
      "Responses background mode cannot be combined with streaming",
    );
  }

  const config = options.config ?? responsesRelayConfig;
  const resolved = await resolveResponseCreateTargets(request, true);
  const targets = options.requireBillableUsage
    ? resolved.targets.filter((target) => getModelPricing(target.publicModelId))
    : resolved.targets;
  if (targets.length === 0 && options.requireBillableUsage)
    throw new ApiKeyUnbillableResponseUsageError();
  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateResponseInputTokens(request);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    const startedAt = Date.now();
    try {
      reservation = await reserveForResponseAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const selected = await startResponseStreamAttempt(
        request,
        target,
        options,
        config,
        resolved.requestedModelId,
      );
      let finalized = false;
      return {
        stream: selected.stream,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        latencyMs: Date.now() - startedAt,
        status: selected.status,
        headers: selected.headers,
        abort: selected.abort,
        finalizeSpend: async (usage, outputTokens = 0) => {
          const cost = estimateCost(
            target.publicModelId,
            usage?.input_tokens ?? inputEstimate,
            usage?.output_tokens ?? outputTokens,
            readCachedTokens(usage),
          );
          if (!finalized) {
            finalized = true;
            await settleSpendReservation(reservation, cost);
          }
          return cost ?? reservation?.reservedUsd;
        },
      };
    } catch (error) {
      if (fatalResponseError(error)) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeResponseError(error);
      await safeLogResponseFailure(
        apiKeyId,
        resolved.requestedModelId,
        target,
        Date.now() - startedAt,
        lastError,
      );
      if (
        attempt >= config.retryCount ||
        !retryableResponsesError(lastError, config, options.signal)
      )
        break;
    }
  }
  await safeRefundResponseReservation(reservation, options.requestId);
  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function resolveResponseCreateTargets(request: ResponseCreateRequest, stream: boolean) {
  const resolved = await resolveResponseTargets(request.model);
  if (!resolved) {
    if (await resolveChatModel(request.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support the Responses API",
      );
    }
    throw new Error(`No provider found for model: ${request.model}`);
  }

  let conversionError: UnsupportedResponseConversionError | undefined;
  const targets = resolved.targets.filter((target) => {
    const transport = target.provider.capabilities.responsesTransport;
    if (transport === "native") {
      return stream
        ? Boolean(target.provider.createResponseStream)
        : Boolean(target.provider.createResponse);
    }
    if (transport !== "chat") return false;
    if (stream ? !target.provider.chatCompletionStream : !target.provider.chatCompletion)
      return false;
    try {
      responseRequestToChat(
        { ...request, model: target.upstreamModelId ?? target.modelId },
        { googleCompatible: target.providerName === "google" },
      );
      return true;
    } catch (error) {
      if (error instanceof UnsupportedResponseConversionError) conversionError ??= error;
      return false;
    }
  });

  if (targets.length === 0) {
    throw new UnsupportedResponseFeatureError(
      conversionError?.message ??
        `Selected provider does not support Responses ${stream ? "streaming" : "creation"}`,
    );
  }
  return { ...resolved, targets };
}

async function reserveForResponseAttempt(
  request: ResponseCreateRequest,
  target: ResolvedProviderModel,
  billing: SpendLimits | undefined,
  requestId: string | undefined,
  reservation: SpendReservation | null,
  inputEstimate: number,
): Promise<SpendReservation | null> {
  if (!billing) return reservation;
  const pricing = getModelPricing(target.publicModelId);
  if (!pricing) throw new ApiKeyUnbillableResponseUsageError();
  const outputTokens =
    typeof request.max_output_tokens === "number"
      ? request.max_output_tokens
      : pricing.maxOutputTokens;
  const liability = estimateCost(
    target.publicModelId,
    Math.max(inputEstimate, 500),
    Math.max(outputTokens, 0),
  );
  if (liability === undefined) throw new ApiKeyUnbillableResponseUsageError();
  if (liability <= 0) return reservation;
  if (!reservation) return reserveSpend(billing, requestId ?? randomUUID(), liability);
  await expandSpendReservation(reservation, liability);
  return reservation;
}

async function runResponseAttempt(
  request: ResponseCreateRequest,
  target: ResolvedProviderModel,
  options: HandleResponseOptions,
  config: ResponsesRelayConfig,
): Promise<{ response: ResponseObject; status: number; headers: Headers }> {
  const attempt = responseAttemptSignal(options.signal);
  let status = 200;
  let headers = new Headers();
  const prepared = buildOpenAIResponseCreateRequest(request, target, options.requestContext);
  const providerOptions = providerRequestOptions(
    prepared.headers,
    target.provider.capabilities.responsesTransport === "native"
      ? rawPassThroughBody(target, options.rawBody)
      : undefined,
    attempt.controller.signal,
    (response) => {
      status = response.status;
      headers = new Headers(response.headers);
    },
  );

  try {
    const operation =
      target.provider.capabilities.responsesTransport === "chat"
        ? target.provider
            .chatCompletion(
              responseRequestToChat(prepared.body, {
                googleCompatible: target.providerName === "google",
              }),
              providerOptions,
            )
            .then((response) => chatResponseToResponse(response, request.model))
        : target.provider.createResponse?.(prepared.body, providerOptions);
    if (!operation)
      throw new UnsupportedResponseFeatureError(
        "Selected provider does not support Responses creation",
      );
    const response = await responseRaceWithTimeout(
      operation,
      config.nonStreamTimeoutMs,
      "non_stream",
      attempt.controller,
      options.signal,
    );
    return { response, status, headers };
  } finally {
    attempt.cleanup();
  }
}

async function startResponseStreamAttempt(
  request: ResponseCreateRequest,
  target: ResolvedProviderModel,
  options: HandleResponseOptions,
  config: ResponsesRelayConfig,
  publicModel: string,
): Promise<{ stream: AsyncIterable<string>; status: number; headers: Headers; abort: () => void }> {
  const attempt = responseAttemptSignal(options.signal);
  let status = 200;
  let headers = new Headers();
  const prepared = buildOpenAIResponseCreateRequest(
    { ...request, stream: true },
    target,
    options.requestContext,
  );
  const providerOptions = providerRequestOptions(
    prepared.headers,
    target.provider.capabilities.responsesTransport === "native"
      ? rawPassThroughBody(target, options.rawBody)
      : undefined,
    attempt.controller.signal,
    (response) => {
      status = response.status;
      headers = new Headers(response.headers);
    },
  );
  let iterator: AsyncIterator<string> | undefined;
  try {
    const source =
      target.provider.capabilities.responsesTransport === "chat"
        ? chatStreamToResponses(
            target.provider.chatCompletionStream(
              responseRequestToChat(prepared.body, {
                googleCompatible: target.providerName === "google",
              }),
              providerOptions,
            ),
            publicModel,
          )
        : target.provider.createResponseStream?.(prepared.body, providerOptions);
    if (!source)
      throw new UnsupportedResponseFeatureError(
        "Selected provider does not support Responses streaming",
      );
    iterator = source[Symbol.asyncIterator]();
    const first = await responseRaceWithTimeout(
      iterator.next(),
      config.firstByteTimeoutMs,
      "first_byte",
      attempt.controller,
      options.signal,
    );
    if (first.done)
      throw new ResponsesRelayProtocolError("Upstream stream ended before its first event");
    return {
      status,
      headers,
      abort: () => attempt.controller.abort(new ResponsesRelayClientAbortError()),
      stream: responseStreamWithIdleTimeout(
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
    closeResponseIterator(iterator);
    throw error;
  }
}

async function* responseStreamWithIdleTimeout(
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
      const next = await responseRaceWithTimeout(
        iterator.next(),
        timeoutMs,
        "idle",
        controller,
        parentSignal,
      );
      if (next.done) return;
      yield next.value;
    }
  } finally {
    cleanup();
    controller.abort(new ResponsesRelayClientAbortError());
    closeResponseIterator(iterator);
  }
}

function responseAttemptSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(new ResponsesRelayClientAbortError());
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  return { controller, cleanup: () => parentSignal?.removeEventListener("abort", abort) };
}

async function responseRaceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  phase: "first_byte" | "idle" | "non_stream",
  controller: AbortController,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new ResponsesRelayClientAbortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ResponsesRelayTimeoutError(phase);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!parentSignal) return;
    abortListener = () => reject(new ResponsesRelayClientAbortError());
    parentSignal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) parentSignal?.removeEventListener("abort", abortListener);
  }
}

function closeResponseIterator(iterator: AsyncIterator<string> | undefined) {
  try {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
  } catch {
    // The primary stream result is already being surfaced.
  }
}

function assertResponseObject(response: ResponseObject): void {
  const value = response as Record<string, unknown>;
  if (value.error && (!value.id || value.object !== "response")) {
    throw new ResponsesRelayProtocolError("Upstream returned an error envelope with HTTP 200");
  }
  if (
    typeof value.id !== "string" ||
    value.object !== "response" ||
    typeof value.status !== "string" ||
    typeof value.model !== "string" ||
    !Array.isArray(value.output)
  ) {
    throw new ResponsesRelayProtocolError("Upstream returned a malformed Response object");
  }
}

function normalizeResponseError(error: unknown): unknown {
  if (error instanceof SyntaxError)
    return new ResponsesRelayProtocolError("Upstream returned malformed JSON");
  if (
    error instanceof UpstreamOpenAICompatibleError ||
    error instanceof ResponsesRelayClientAbortError ||
    error instanceof ResponsesRelayTimeoutError ||
    error instanceof ResponsesRelayProtocolError
  ) {
    return error;
  }
  return new ResponsesRelayProtocolError("Upstream request failed");
}

function fatalResponseError(error: unknown): boolean {
  return (
    error instanceof ChannelParamOverrideError ||
    error instanceof ChannelHeaderOverrideError ||
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError ||
    error instanceof ApiKeySpendLimitExceededError ||
    error instanceof ApiKeyUnbillableResponseUsageError ||
    error instanceof UnsupportedResponseFeatureError ||
    error instanceof UnsupportedResponseConversionError
  );
}

async function safeRefundResponseReservation(
  reservation: SpendReservation | null,
  requestId?: string,
): Promise<boolean> {
  try {
    await refundSpendReservation(reservation);
    return true;
  } catch (error) {
    console.error("responses_spend_refund_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function logResponseAttempt(
  apiKeyId: string,
  requestedModel: string,
  target: ResolvedProviderModel,
  latencyMs: number,
  statusCode: number,
  response: ResponseObject,
  estimatedCost?: number,
) {
  await logRequest({
    apiKeyId,
    provider: target.providerName,
    model: target.publicModelId,
    requestedModel,
    channelId: target.channelId,
    channelName: target.channelName,
    endpoint: "/v1/responses",
    latencyMs,
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
    totalTokens: response.usage?.total_tokens,
    reasoningTokens: readReasoningTokens(response.usage),
    estimatedCost,
    statusCode,
  });
}

async function safeLogResponseFailure(
  apiKeyId: string,
  requestedModel: string,
  target: ResolvedProviderModel,
  latencyMs: number,
  error: unknown,
  endpoint = "/v1/responses",
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
      statusCode: responsesRelayStatus(error),
      errorMessage: responseFailureLogMessage(error),
    });
  } catch (loggingError) {
    if (loggingError instanceof RequestLoggingUnavailableError) throw loggingError;
  }
}

function responseFailureLogMessage(error: unknown): string {
  if (error instanceof UpstreamOpenAICompatibleError) {
    return `${error.provider} upstream error (status ${error.status})`;
  }
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return `Upstream error (status ${(error as { status: number }).status})`;
  }
  if (error instanceof Error) {
    const status = /Responses API error: (\d{3})\b/.exec(error.message)?.[1];
    if (status) return `Upstream error (status ${status})`;
  }
  if (
    error instanceof ResponsesRelayClientAbortError ||
    error instanceof ResponsesRelayTimeoutError ||
    error instanceof ResponsesRelayProtocolError
  ) {
    return error.message;
  }
  return "Upstream request failed";
}

export async function submitBackgroundResponse(
  request: ResponseCreateRequest,
  apiKeyId: string,
  options: HandleResponseOptions = {},
): Promise<{ id: string; response: ResponseObject }> {
  const resolved = await resolveResponseTargets(request.model);
  if (!resolved) {
    if (await resolveChatModel(request.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support the Responses API",
      );
    }
    throw new Error(`No provider found for model: ${request.model}`);
  }
  const capableTargets = resolved.targets.filter(
    (candidate) =>
      candidate.provider.capabilities.responsesTransport === "native" &&
      candidate.provider.createResponse &&
      candidate.provider.getResponse,
  );
  if (capableTargets.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Responses background mode requires a native provider with retrieval support",
    );
  }
  const targets = options.requireBillableUsage
    ? capableTargets.filter((target) => getModelPricing(target.publicModelId))
    : capableTargets;
  if (targets.length === 0 && options.requireBillableUsage) {
    throw new ApiKeyUnbillableResponseUsageError();
  }

  const config = options.config ?? responsesRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  const requestedModelId = resolved.requestedModelId;
  const inputEstimate = estimateResponseInputTokens(request);
  let selectedTarget: ResolvedProviderModel | undefined;
  let attemptStartedAt = new Date();
  let latencyMs = 0;
  let response: ResponseObject | undefined;
  let upstreamCreateUrl = "";
  let reservation: SpendReservation | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    const createResponse = target.provider.createResponse;
    if (!createResponse) continue;
    const attemptSignal = responseAttemptSignal(options.signal);
    const attemptStartTime = Date.now();
    attemptStartedAt = new Date(attemptStartTime);
    try {
      reservation = await reserveForResponseAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const prepared = buildOpenAIResponseCreateRequest(request, target, options.requestContext);
      const providerOptions = providerRequestOptions(
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
        attemptSignal.controller.signal,
        (upstream) => {
          upstreamCreateUrl = upstream.url;
        },
      );
      response = await responseRaceWithTimeout(
        createResponse.call(target.provider, prepared.body, providerOptions),
        config.nonStreamTimeoutMs,
        "non_stream",
        attemptSignal.controller,
        options.signal,
      );
      assertResponseObject(response);
      latencyMs = Date.now() - attemptStartTime;
      selectedTarget = target;
      break;
    } catch (error) {
      latencyMs = Date.now() - attemptStartTime;
      if (fatalResponseError(error)) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw error;
      }
      lastError = normalizeResponseError(error);
      await safeLogResponseFailure(apiKeyId, requestedModelId, target, latencyMs, lastError);
      if (
        attempt >= config.retryCount ||
        !retryableResponsesError(lastError, config, options.signal)
      ) {
        break;
      }
    } finally {
      attemptSignal.cleanup();
    }
  }

  if (!selectedTarget || !response) {
    await safeRefundResponseReservation(reservation, options.requestId);
    throw lastError ?? new Error(`No provider found for model: ${request.model}`);
  }
  const target = selectedTarget;
  const pricing = getModelPricing(target.publicModelId);

  const upstreamId = typeof response.id === "string" ? response.id : null;
  if (!upstreamId) {
    await safeRefundResponseReservation(reservation, options.requestId);
    throw new ResponsesRelayProtocolError("Upstream provider did not return a response id");
  }

  const upstreamStatus = typeof response.status === "string" ? response.status : "queued";
  const terminal = isTerminalResponseStatus(upstreamStatus);
  const usage = response.usage;
  const cachedTokens = readCachedTokens(usage);
  const reasoningTokens = readReasoningTokens(usage);
  const estimatedCost =
    terminal && upstreamStatus === "completed"
      ? estimateCost(
          target.publicModelId,
          usage?.input_tokens ?? inputEstimate,
          usage?.output_tokens ?? estimateResponseOutputTokens(response),
          cachedTokens,
        )
      : undefined;

  if (options.requireBillableUsage && terminal && upstreamStatus === "completed") {
    if (estimatedCost === undefined) {
      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/responses",
        latencyMs,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: usage?.total_tokens,
        reasoningTokens,
        statusCode: 429,
        errorMessage: "Billable usage could not be determined",
      });
      await safeRefundResponseReservation(reservation, options.requestId);
      throw new ApiKeyUnbillableResponseUsageError();
    }
  }

  let persisted = false;
  try {
    await prisma.backgroundResponseJob.create({
      data: {
        id: upstreamId,
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        request: request as object,
        status: upstreamStatus,
        response: response as object,
        inputPricePer1M: pricing?.inputPricePer1M ?? null,
        outputPricePer1M: pricing?.outputPricePer1M ?? null,
        pricingTiers: pricing?.pricingTiers ?? [],
        upstreamUrl: buildBackgroundResponseUrl(target.providerName, upstreamCreateUrl, upstreamId),
        spendReservationId: reservation?.requestId ?? null,
        spendReservedUsd: reservation?.reservedUsd ?? null,
        spendOwnerId: reservation?.limits.ownerId ?? null,
        startedAt: attemptStartedAt,
        ...(terminal ? { completedAt: new Date() } : {}),
      },
    });
    persisted = true;

    if (!terminal) {
      await enqueueBackgroundPoll(upstreamId, 1, backoffMs(1));
    }
  } catch (error) {
    const refunded = await safeRefundResponseReservation(reservation, options.requestId);
    if (!terminal && persisted) {
      try {
        await prisma.backgroundResponseJob.update({
          where: { id: upstreamId },
          data: {
            status: "failed",
            errorMessage: `Background poll enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
            completedAt: new Date(),
            ...(refunded
              ? {
                  spendReservationId: null,
                  spendReservedUsd: null,
                  spendOwnerId: null,
                }
              : {}),
          },
        });
      } catch (cleanupError) {
        console.error("background_response_enqueue_cleanup_failed", {
          requestId: options.requestId,
          responseId: upstreamId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    throw error;
  }

  if (terminal) {
    try {
      if (upstreamStatus === "completed") {
        if (options.requireBillableUsage && !options.billing && estimatedCost !== undefined) {
          await addApiKeySpendUsd(apiKeyId, estimatedCost);
        }
        await settleSpendReservation(reservation, estimatedCost);
      } else {
        await refundSpendReservation(reservation);
      }
    } catch (error) {
      if (reservation) {
        try {
          await enqueueBackgroundPoll(upstreamId, 1, backoffMs(1));
        } catch (enqueueError) {
          console.error("background_response_billing_repair_enqueue_failed", {
            requestId: options.requestId,
            responseId: upstreamId,
            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
          });
        }
      }
      throw error;
    }

    if (reservation) {
      try {
        await prisma.backgroundResponseJob.update({
          where: { id: upstreamId },
          data: {
            spendReservationId: null,
            spendReservedUsd: null,
            spendOwnerId: null,
          },
        });
      } catch (error) {
        console.error("background_response_billing_metadata_cleanup_failed", {
          requestId: options.requestId,
          responseId: upstreamId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await logRequest({
    apiKeyId,
    provider: target.providerName,
    model: target.publicModelId,
    requestedModel: requestedModelId,
    channelId: target.channelId,
    channelName: target.channelName,
    endpoint: "/v1/responses",
    latencyMs,
    promptTokens: usage?.input_tokens,
    completionTokens: usage?.output_tokens,
    totalTokens: usage?.total_tokens,
    reasoningTokens,
    estimatedCost,
    statusCode: 202,
  });

  return {
    id: upstreamId,
    response: withPublicModelId(response, requestedModelId),
  };
}

function buildBackgroundResponseUrl(
  providerName: string,
  createUrl: string,
  id: string,
): string | null {
  if (createUrl) {
    try {
      const url = new URL(createUrl);
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
      return url.toString();
    } catch {
      // Fall through to the known provider URL.
    }
  }
  if (providerName === "openai") {
    return `https://api.openai.com/v1/responses/${encodeURIComponent(id)}`;
  }
  if (providerName === "azure" || providerName === "azure-cognitive-services") {
    const endpoint = process.env.AZURE_OPENAI_RESPONSES_ENDPOINT;
    if (!endpoint) return null;
    const version = process.env.AZURE_OPENAI_RESPONSES_API_VERSION ?? "2025-04-01-preview";
    return `${endpoint.replace(/\/$/, "")}/openai/v1/responses/${encodeURIComponent(id)}?api-version=${encodeURIComponent(version)}`;
  }
  return null;
}

export class OpenAIResponseProviderNotConfiguredError extends Error {
  constructor() {
    super("OpenAI provider is not configured");
    this.name = "OpenAIResponseProviderNotConfiguredError";
  }
}

function responseUtilityProviderCandidates(method: keyof ProviderAdapter): ProviderAdapter[] {
  return responseUtilityConfiguredProviders().filter((provider) => Boolean(provider[method]));
}

function responseUtilityConfiguredProviders(): ProviderAdapter[] {
  const preferred = ["openai", "azure-cognitive-services", "azure"];
  const names = Array.from(
    new Set([
      ...preferred,
      ...listConfiguredProviders(),
      ...(process.env.E2E_RESET_TOKEN ? ["e2e"] : []),
    ]),
  );
  return names
    .map((name) => getProviderByName(name))
    .filter((provider): provider is ProviderAdapter => Boolean(provider))
    .filter(
      (provider) =>
        preferred.includes(provider.name) ||
        provider.name === "e2e" ||
        provider.capabilities.responsesTransport === "native",
    );
}

export class ResponseNotFoundError extends Error {
  constructor(id: string) {
    super(`Response not found: ${id}`);
    this.name = "ResponseNotFoundError";
  }
}

export async function handleResponseRetrieve(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<ResponseObject> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    assertLocalBackgroundOwnership(localRow, apiKeyId, id);
    const pending = !isTerminalResponseStatus(localRow.status);
    const body = buildLocalBackgroundResponse(localRow);
    await logRequest({
      apiKeyId,
      provider: localRow.provider,
      model: localRow.model,
      requestedModel: readRequestedModel(localRow),
      channelId: localRow.channelId ?? undefined,
      channelName: localRow.channelName ?? undefined,
      endpoint: "/v1/responses/:id",
      latencyMs: 0,
      statusCode: pending ? 202 : 200,
    });

    if (pending) {
      return { ...body, _pending: true } as ResponseObject;
    }

    return body;
  }

  if (isResponsesCacheEnabled()) {
    const cached = await readCachedResponse(apiKeyId, "openai", id);
    if (cached) {
      return cached;
    }
  }

  const configuredProviders = responseUtilityConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }
  const candidates = configuredProviders.filter((provider) => Boolean(provider.getResponse));
  if (candidates.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response retrieval",
    );
  }

  let lastError: unknown = null;
  let lastLatencyMs = 0;

  for (const provider of candidates) {
    const attemptStartTime = Date.now();
    try {
      const response = await provider.getResponse?.(id, query);
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (!response) continue;

      if (isResponsesCacheEnabled()) {
        await writeCachedResponse(
          apiKeyId,
          provider.name,
          id,
          response,
          getResponsesCacheTtlSeconds(),
        );
      }

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 200,
      });

      return response;
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      lastError = error;
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (isUpstreamNotFoundError(error)) {
        continue;
      }

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: responsesRelayStatus(error),
        errorMessage: responseFailureLogMessage(error),
      });

      throw error;
    }
  }

  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseDelete(id: string, apiKeyId: string): Promise<ResponseObject> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    assertLocalBackgroundOwnership(localRow, apiKeyId, id);
    return deleteLocalBackgroundJob(localRow, id, apiKeyId);
  }

  const configuredProviders = responseUtilityConfiguredProviders();
  if (configuredProviders.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }
  const candidates = configuredProviders.filter((provider) => Boolean(provider.deleteResponse));
  if (candidates.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response deletion",
    );
  }

  let lastError: unknown = null;
  let lastLatencyMs = 0;

  for (const provider of candidates) {
    const attemptStartTime = Date.now();
    try {
      const response = await provider.deleteResponse?.(id);
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (!response) continue;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 200,
      });

      return response;
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      lastError = error;
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (isUpstreamNotFoundError(error)) {
        continue;
      }

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: responsesRelayStatus(error),
        errorMessage: responseFailureLogMessage(error),
      });

      throw error;
    }
  }

  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseInputItems(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const localRow = await prisma.backgroundResponseJob.findUnique({ where: { id } });
  if (localRow) {
    assertLocalBackgroundOwnership(localRow, apiKeyId, id);
    const provider = getProviderForChannel(localRow.provider, localRow.channelId);
    if (!provider?.listResponseInputItems) {
      throw new UnsupportedResponseFeatureError(
        "Selected provider does not support response input item retrieval",
      );
    }
    const startedAt = Date.now();
    const providerOptions = staticChannelProviderOptions(localRow.provider, localRow.channelId);
    const response = providerOptions
      ? await provider.listResponseInputItems(id, query, providerOptions)
      : await provider.listResponseInputItems(id, query);
    await logRequest({
      apiKeyId,
      provider: localRow.provider,
      model: localRow.model,
      requestedModel: readRequestedModel(localRow),
      channelId: localRow.channelId ?? undefined,
      channelName: localRow.channelName ?? undefined,
      endpoint: "/v1/responses/:id/input_items",
      latencyMs: Date.now() - startedAt,
      statusCode: 200,
    });
    return { provider: localRow.provider, model: localRow.model, response };
  }

  const candidates = responseUtilityProviderCandidates("listResponseInputItems");

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  let lastError: unknown = null;
  let lastLatencyMs = 0;

  for (const provider of candidates) {
    const attemptStartTime = Date.now();
    try {
      const response = await provider.listResponseInputItems?.(id, query);
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (!response) continue;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id/input_items",
        latencyMs,
        statusCode: 200,
      });

      return { provider: provider.name, model: provider.name, response };
    } catch (error) {
      lastError = error;
      lastLatencyMs = Date.now() - attemptStartTime;
      if (isUpstreamNotFoundError(error)) {
        continue;
      }
      throw error;
    }
  }

  // Every configured provider returned 404.
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id/input_items",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseInputTokens(
  body: ResponseCreateRequest,
  apiKeyId: string,
  options: HandleResponseOptions = {},
): Promise<{
  provider: string;
  model: string;
  response: ResponseObject;
  status: number;
  headers: Headers;
}> {
  const resolved = await resolveResponseTargets(body.model);
  if (!resolved) {
    if (await resolveChatModel(body.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support Responses input token counting",
      );
    }
    throw new Error(`No provider found for model: ${body.model}`);
  }

  const targets = resolved.targets.filter(
    (target) =>
      target.provider.capabilities.responsesTransport === "native" &&
      Boolean(target.provider.countResponseInputTokens),
  );
  if (targets.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support Responses input token counting",
    );
  }

  const config = options.config ?? responsesRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  let lastError: unknown;
  let lastLatencyMs = 0;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    const countInputTokens = target.provider.countResponseInputTokens;
    if (!countInputTokens) continue;
    const attemptSignal = responseAttemptSignal(options.signal);
    let status = 200;
    let headers = new Headers();
    const attemptStartTime = Date.now();
    try {
      const prepared = buildOpenAIResponseCreateRequest(body, target, options.requestContext);
      const providerOptions = providerRequestOptions(
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
        attemptSignal.controller.signal,
        (upstream) => {
          status = upstream.status;
          headers = new Headers(upstream.headers);
        },
      );
      const response = await responseRaceWithTimeout(
        countInputTokens.call(target.provider, prepared.body, providerOptions),
        config.nonStreamTimeoutMs,
        "non_stream",
        attemptSignal.controller,
        options.signal,
      );
      const latencyMs = Date.now() - attemptStartTime;

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: body.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/responses/input_tokens",
        latencyMs,
        statusCode: status,
      });

      return {
        provider: target.providerName,
        model: resolved.requestedModelId,
        response,
        status,
        headers,
      };
    } catch (error) {
      if (
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        throw error;
      }
      if (error instanceof RequestLoggingUnavailableError) throw error;
      lastError = normalizeResponseError(error);
      lastLatencyMs = Date.now() - attemptStartTime;
      await safeLogResponseFailure(
        apiKeyId,
        resolved.requestedModelId,
        target,
        lastLatencyMs,
        lastError,
        "/v1/responses/input_tokens",
      );
      if (
        !isUpstreamNotFoundError(lastError) &&
        (attempt >= config.retryCount ||
          !retryableResponsesError(lastError, config, options.signal))
      ) {
        throw lastError;
      }
    } finally {
      attemptSignal.cleanup();
    }
  }

  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: body.model,
    requestedModel: body.model,
    endpoint: "/v1/responses/input_tokens",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(`(model: ${body.model})`);
}

function buildOpenAIResponseCreateRequest(
  request: ResponseCreateRequest,
  target: ResolvedProviderModel,
  context?: ChannelOverrideRequestContext,
): PreparedChannelRequest<ResponseCreateRequest> {
  const body: Record<string, unknown> = {};

  for (const field of RESPONSE_CREATE_FIELDS) {
    if (Object.hasOwn(request, field)) {
      body[field] = request[field];
    }
  }

  const normalizedModel = responseReasoningModel(target.upstreamModelId ?? target.modelId);
  body.model = normalizedModel.model;
  if (normalizedModel.effort) {
    const reasoning =
      body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)
        ? { ...(body.reasoning as Record<string, unknown>) }
        : {};
    reasoning.effort = normalizedModel.effort;
    body.reasoning = reasoning;
  }
  return prepareChannelResponseRequestSettings(
    body as ResponseCreateRequest,
    target,
    targetRequestContext(request, target, context),
  );
}

function responseReasoningModel(model: string): { model: string; effort?: string } {
  for (const effort of ["xhigh", "minimal", "medium", "high", "none", "low"]) {
    const suffix = `-${effort}`;
    if (model.endsWith(suffix)) return { model: model.slice(0, -suffix.length), effort };
  }
  return { model };
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
  headers: Record<string, string>,
  rawBody?: string,
  signal?: AbortSignal,
  onResponse?: (response: Response) => void,
) {
  return Object.keys(headers).length > 0 || rawBody !== undefined || signal || onResponse
    ? {
        headers,
        ...(rawBody !== undefined ? { rawBody } : {}),
        ...(signal ? { signal } : {}),
        ...(onResponse ? { onResponse } : {}),
      }
    : undefined;
}

function readCachedTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as { input_tokens_details?: unknown }).input_tokens_details;
  if (!details || typeof details !== "object") return undefined;
  const cached = (details as { cached_tokens?: unknown }).cached_tokens;
  return typeof cached === "number" && Number.isFinite(cached) ? cached : undefined;
}

export function readReasoningTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as { output_tokens_details?: unknown }).output_tokens_details;
  if (!details || typeof details !== "object") return undefined;
  const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
  return typeof reasoning === "number" && Number.isFinite(reasoning) ? reasoning : undefined;
}

function withPublicModelId(response: ResponseObject, publicModelId: string): ResponseObject {
  if (!Object.hasOwn(response, "model")) return response;
  return { ...response, model: publicModelId };
}

export async function handleResponseCancel(
  id: string,
  apiKeyId: string,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    assertLocalBackgroundOwnership(localRow, apiKeyId, id);
    return cancelLocalBackgroundJob(localRow, id, apiKeyId);
  }

  const candidates = responseUtilityProviderCandidates("cancelResponse");

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  let lastError: unknown = null;
  let lastLatencyMs = 0;

  for (const provider of candidates) {
    const attemptStartTime = Date.now();
    try {
      const response = await provider.cancelResponse?.(id);
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      if (!response) continue;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id/cancel",
        latencyMs,
        statusCode: 200,
      });

      return { provider: provider.name, model: provider.name, response };
    } catch (error) {
      lastError = error;
      lastLatencyMs = Date.now() - attemptStartTime;
      if (isUpstreamNotFoundError(error)) {
        continue;
      }
      throw error;
    }
  }

  // Every configured provider returned 404.
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id/cancel",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

type LocalBackgroundRow = {
  id: string;
  apiKeyId: string;
  provider: string;
  model: string;
  channelId?: string | null;
  channelName?: string | null;
  request?: unknown;
  status: string;
  response: unknown;
  spendReservationId?: string | null;
  spendReservedUsd?: number | null;
  spendOwnerId?: string | null;
};

function assertLocalBackgroundOwnership(
  row: LocalBackgroundRow,
  apiKeyId: string,
  id: string,
): void {
  if (row.apiKeyId !== apiKeyId) throw new ResponseNotFoundError(id);
}

function isTerminalResponseStatus(status: string): boolean {
  return TERMINAL_RESPONSE_STATUSES.has(status);
}

function buildLocalBackgroundResponse(row: LocalBackgroundRow): ResponseObject {
  const response =
    row.response !== null && typeof row.response === "object" ? (row.response as object) : {};
  return {
    ...response,
    id: row.id,
    model: readRequestedModel(row) ?? row.model,
    object: "response",
    status: row.status,
  } as ResponseObject;
}

function localBackgroundReservation(row: LocalBackgroundRow): SpendReservation | null {
  if (!row.spendReservationId) return null;
  return {
    requestId: row.spendReservationId,
    reservedUsd: row.spendReservedUsd ?? 0,
    limits: {
      apiKeyId: row.apiKeyId,
      ownerId: row.spendOwnerId ?? undefined,
    },
  };
}

async function finalizeLocalBackgroundReservation(
  row: LocalBackgroundRow,
  status: string,
): Promise<void> {
  const reservation = localBackgroundReservation(row);
  if (!reservation) return;
  if (status === "completed") {
    const response =
      row.response && typeof row.response === "object"
        ? (row.response as ResponseObject)
        : undefined;
    const usage = response?.usage;
    const hasUsage =
      typeof usage?.input_tokens === "number" || typeof usage?.output_tokens === "number";
    const actualCost = hasUsage
      ? estimateCost(
          row.model,
          usage?.input_tokens ?? 0,
          usage?.output_tokens ?? 0,
          readCachedTokens(usage),
        )
      : undefined;
    await settleSpendReservation(reservation, actualCost ?? reservation.reservedUsd);
  } else {
    await refundSpendReservation(reservation);
  }
}

function readRequestedModel(row: LocalBackgroundRow): string | undefined {
  if (!row.request || typeof row.request !== "object") return undefined;
  const model = (row.request as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function isUpstreamNotFoundError(error: unknown): boolean {
  if (error instanceof UpstreamResponsesApiError && error.status === 404) {
    return true;
  }
  if (error instanceof UpstreamOpenAICompatibleError && error.status === 404) {
    return true;
  }
  return error instanceof Error && /Responses API error: 404\b/.test(error.message);
}

async function cancelLocalBackgroundJob(
  row: LocalBackgroundRow,
  id: string,
  apiKeyId: string,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const provider = getProviderForChannel(row.provider, row.channelId);
  let upstreamResponse: ResponseObject | null = null;
  let upstreamNotFound = false;
  let latencyMs = 0;

  if (provider?.cancelResponse) {
    let attemptStartTime: number | undefined;
    try {
      const providerOptions = staticChannelProviderOptions(row.provider, row.channelId);
      attemptStartTime = Date.now();
      upstreamResponse = providerOptions
        ? await provider.cancelResponse(id, providerOptions)
        : await provider.cancelResponse(id);
      latencyMs = Date.now() - attemptStartTime;
    } catch (error) {
      latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      if (isUpstreamNotFoundError(error)) {
        upstreamNotFound = true;
      } else {
        throw error;
      }
    }
  }

  const now = new Date();
  const merged: ResponseObject = {
    ...((upstreamResponse as object | null) ?? (row.response as object | null) ?? {}),
    id: row.id,
    model: readRequestedModel(row) ?? row.model,
    object: "response",
    status: "cancelled",
  };

  await finalizeLocalBackgroundReservation(row, "cancelled");
  await prisma.backgroundResponseJob.update({
    where: { id: row.id },
    data: {
      status: "cancelled",
      response: merged as object,
      completedAt: now,
      spendReservationId: null,
      spendReservedUsd: null,
      spendOwnerId: null,
      ...(upstreamNotFound ? { errorMessage: "upstream 404 on cancel" } : {}),
    },
  });

  await logRequest({
    apiKeyId,
    provider: row.provider,
    model: row.model,
    requestedModel: readRequestedModel(row),
    channelId: row.channelId ?? undefined,
    channelName: row.channelName ?? undefined,
    endpoint: "/v1/responses/:id/cancel",
    latencyMs,
    statusCode: 200,
  });

  return { provider: row.provider, model: row.model, response: merged };
}

async function deleteLocalBackgroundJob(
  row: LocalBackgroundRow,
  id: string,
  apiKeyId: string,
): Promise<ResponseObject> {
  const provider = getProviderForChannel(row.provider, row.channelId);
  let latencyMs = 0;
  if (provider?.deleteResponse) {
    let attemptStartTime: number | undefined;
    try {
      const providerOptions = staticChannelProviderOptions(row.provider, row.channelId);
      attemptStartTime = Date.now();
      if (providerOptions) {
        await provider.deleteResponse(id, providerOptions);
      } else {
        await provider.deleteResponse(id);
      }
      latencyMs = Date.now() - attemptStartTime;
    } catch (error) {
      latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      if (!isUpstreamNotFoundError(error)) {
        throw error;
      }
    }
  }

  await finalizeLocalBackgroundReservation(row, row.status);
  await prisma.backgroundResponseJob.delete({
    where: { id: row.id },
  });

  await logRequest({
    apiKeyId,
    provider: row.provider,
    model: row.model,
    requestedModel: readRequestedModel(row),
    channelId: row.channelId ?? undefined,
    channelName: row.channelName ?? undefined,
    endpoint: "/v1/responses/:id",
    latencyMs,
    statusCode: 200,
  });

  return {
    id: row.id,
    object: "response",
    deleted: true,
  } as ResponseObject;
}

function staticChannelProviderOptions(
  providerName: string,
  channelId?: string | null,
): { headers: Record<string, string> } | undefined {
  const runtime = getProviderChannelRuntime(providerName, channelId);
  if (!runtime) return undefined;
  const headers = resolveChannelHeaders(runtime, { apiKey: runtime.apiKey });
  return { headers };
}

export async function handleResponseCompact(
  request: ResponseCompactRequest,
  apiKeyId: string,
  options: HandleResponseOptions = {},
): Promise<{
  provider: string;
  model: string;
  response: ResponseObject;
  status: number;
  headers: Headers;
}> {
  const resolved = await resolveResponseTargets(request.model);
  if (!resolved) {
    if (await resolveChatModel(request.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support Responses compaction",
      );
    }
    throw new Error(`No provider found for model: ${request.model}`);
  }

  const capableTargets = resolved.targets.filter(
    (target) =>
      target.provider.capabilities.responsesTransport === "native" &&
      Boolean(target.provider.compactResponse),
  );
  if (capableTargets.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support Responses compaction",
    );
  }
  const targets = options.requireBillableUsage
    ? capableTargets.filter((target) => getModelPricing(target.publicModelId))
    : capableTargets;
  if (targets.length === 0 && options.requireBillableUsage) {
    throw new ApiKeyUnbillableResponseUsageError();
  }

  const config = options.config ?? responsesRelayConfig;
  const selector = createChatCandidateSelector(targets, options.random);
  const inputEstimate = estimateResponseInputTokens(request);
  let reservation: SpendReservation | null = null;
  let lastError: unknown;
  let lastLatencyMs = 0;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const target = selector.next();
    if (!target) break;
    const compactResponse = target.provider.compactResponse;
    if (!compactResponse) continue;
    const attemptStartTime = Date.now();
    const attemptSignal = responseAttemptSignal(options.signal);
    let status = 200;
    let headers = new Headers();
    try {
      reservation = await reserveForResponseAttempt(
        request,
        target,
        options.billing,
        options.requestId,
        reservation,
        inputEstimate,
      );
      const prepared = buildProviderCompactRequest(request, target, options.requestContext);
      const providerOptions = providerRequestOptions(
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
        attemptSignal.controller.signal,
        (upstream) => {
          status = upstream.status;
          headers = new Headers(upstream.headers);
        },
      );
      const response = await responseRaceWithTimeout(
        compactResponse.call(target.provider, prepared.body, providerOptions),
        config.nonStreamTimeoutMs,
        "non_stream",
        attemptSignal.controller,
        options.signal,
      );
      const latencyMs = Date.now() - attemptStartTime;
      lastLatencyMs = latencyMs;
      const usage = response.usage;
      const cachedTokens = readCachedTokens(usage);
      const reasoningTokens = readReasoningTokens(usage);
      const estimatedCost = estimateCost(
        target.publicModelId,
        usage?.input_tokens ?? inputEstimate,
        usage?.output_tokens ?? estimateResponseOutputTokens(response),
        cachedTokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.providerName,
          model: target.publicModelId,
          requestedModel: request.model,
          channelId: target.channelId,
          channelName: target.channelName,
          endpoint: "/v1/responses/compact",
          latencyMs,
          promptTokens: usage?.input_tokens,
          completionTokens: usage?.output_tokens,
          totalTokens: usage?.total_tokens,
          reasoningTokens,
          statusCode: 429,
          errorMessage: "Billable usage could not be determined",
        });
        throw new ApiKeyUnbillableResponseUsageError();
      }

      if (options.requireBillableUsage && !options.billing && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }
      await settleSpendReservation(reservation, estimatedCost);

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/responses/compact",
        latencyMs,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: usage?.total_tokens,
        reasoningTokens,
        estimatedCost,
        statusCode: status,
      });

      return {
        provider: target.providerName,
        model: resolved.requestedModelId,
        response,
        status,
        headers,
      };
    } catch (error) {
      lastError = normalizeResponseError(error);
      lastLatencyMs = Date.now() - attemptStartTime;
      if (
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw error;
      }
      if (
        error instanceof ApiKeyUnbillableResponseUsageError ||
        error instanceof ApiKeySpendLedgerUnavailableError ||
        error instanceof ApiKeySpendLimitExceededError ||
        error instanceof RequestLoggingUnavailableError
      ) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw error;
      }
      await safeLogResponseFailure(
        apiKeyId,
        resolved.requestedModelId,
        target,
        lastLatencyMs,
        lastError,
        "/v1/responses/compact",
      );
      if (
        !isUpstreamNotFoundError(lastError) &&
        (attempt >= config.retryCount ||
          !retryableResponsesError(lastError, config, options.signal))
      ) {
        await safeRefundResponseReservation(reservation, options.requestId);
        throw lastError;
      }
    } finally {
      attemptSignal.cleanup();
    }
  }

  await safeRefundResponseReservation(reservation, options.requestId);
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    requestedModel: request.model,
    endpoint: "/v1/responses/compact",
    latencyMs: lastLatencyMs,
    statusCode: 404,
    errorMessage: lastError ? responseFailureLogMessage(lastError) : "Response not found",
  });
  throw new ResponseNotFoundError(request.model);
}

function buildProviderCompactRequest(
  request: ResponseCompactRequest,
  target: ResolvedProviderModel,
  context?: ChannelOverrideRequestContext,
): PreparedChannelRequest<ResponseCompactRequest> {
  return prepareChannelCompactRequestSettings(
    { ...request, model: target.upstreamModelId ?? target.modelId },
    target,
    targetRequestContext(request, target, context),
  );
}

function rawPassThroughBody(target: ResolvedProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}
