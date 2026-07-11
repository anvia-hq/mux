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
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export type AnthropicMessageResult =
  | {
      kind: "stream";
      stream: AsyncIterable<string>;
      provider: string;
      model: string;
      channelId?: string;
      channelName?: string;
      latencyMs: number;
    }
  | {
      kind: "complete";
      response: AnthropicMessageObject;
    };

export type AnthropicMessageTokenCountResult = {
  provider: string;
  model: string;
  channelId?: string;
  channelName?: string;
  response: AnthropicMessageTokenCountObject;
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
  options: {
    requireBillableUsage?: boolean;
    providerOptions?: ProviderRequestOptions;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<AnthropicMessageResult> {
  const resolved = await resolveAnthropicMessagesModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (
    options.requireBillableUsage &&
    resolved.kind === "direct" &&
    !getModelPricing(resolved.targets[0].publicModelId)
  ) {
    throw new ApiKeyUnbillableAnthropicMessageUsageError();
  }

  if (request.stream === true) {
    const selected = await resolveStreamingTarget(request, apiKeyId, resolved.targets, {
      providerOptions: options.providerOptions,
      requestContext: options.requestContext,
      rawBody: options.rawBody,
    });
    return {
      kind: "stream",
      stream: selected.stream,
      provider: selected.target.providerName,
      model: selected.target.publicModelId,
      channelId: selected.target.channelId,
      channelName: selected.target.channelName,
      latencyMs: selected.latencyMs,
    };
  }

  return createAnthropicMessageWithFallback(request, apiKeyId, resolved.targets, {
    requireBillableUsage: options.requireBillableUsage,
    providerOptions: options.providerOptions,
    requestContext: options.requestContext,
    rawBody: options.rawBody,
  });
}

export async function handleAnthropicMessageTokenCount(
  request: AnthropicMessageCountTokensRequest,
  apiKeyId: string,
  options: {
    providerOptions?: ProviderRequestOptions;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<AnthropicMessageTokenCountResult> {
  const resolved = await resolveAnthropicMessageTokenCountModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  let lastError: unknown;

  for (const target of resolved.targets) {
    let attemptStartTime: number | undefined;
    try {
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        buildAnthropicMessageTokenCountRequest(request, target),
        target,
        targetRequestContext(request, target, options.requestContext),
      );
      const requestOptions = providerRequestOptions(
        options.providerOptions,
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
      );
      attemptStartTime = Date.now();
      const response = requestOptions
        ? await target.provider.countAnthropicMessageTokens(prepared.body, requestOptions)
        : await target.provider.countAnthropicMessageTokens(prepared.body);
      const latencyMs = Date.now() - attemptStartTime;
      const promptTokens = numberOrUndefined(response.input_tokens);

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages/count_tokens",
        latencyMs,
        promptTokens,
        totalTokens: promptTokens,
        statusCode: 200,
      });

      return {
        provider: target.providerName,
        model: resolved.requestedModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        response,
      };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        throw error;
      }

      lastError = error;
      const latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const statusCode = error instanceof UpstreamAnthropicMessagesApiError ? error.status : 500;

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages/count_tokens",
        latencyMs,
        statusCode,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function createAnthropicMessageWithFallback(
  request: AnthropicMessageCreateRequest,
  apiKeyId: string,
  targets: ResolvedAnthropicMessagesProviderModel[],
  options: {
    requireBillableUsage?: boolean;
    providerOptions?: ProviderRequestOptions;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  },
): Promise<AnthropicMessageResult> {
  let lastError: unknown;

  for (const target of targets) {
    let attemptStartTime: number | undefined;
    try {
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        buildAnthropicMessageRequest(request, target, false),
        target,
        targetRequestContext(request, target, options.requestContext),
      );
      const requestOptions = providerRequestOptions(
        options.providerOptions,
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
      );
      attemptStartTime = Date.now();
      const response = requestOptions
        ? await target.provider.createAnthropicMessage(prepared.body, requestOptions)
        : await target.provider.createAnthropicMessage(prepared.body);
      const latencyMs = Date.now() - attemptStartTime;
      const usage = extractAnthropicMessageTokenUsage(response);
      const estimatedCost = estimateCost(
        target.publicModelId,
        usage.promptTokens,
        usage.completionTokens,
        undefined,
        usage.pricingInputTokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.providerName,
          model: target.publicModelId,
          requestedModel: request.model,
          channelId: target.channelId,
          channelName: target.channelName,
          endpoint: "/v1/messages",
          latencyMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          statusCode: 429,
          errorMessage: "Billable usage could not be determined",
        });
        throw new ApiKeyUnbillableAnthropicMessageUsageError();
      }

      if (options.requireBillableUsage && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages",
        latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        pricingInputTokens: usage.pricingInputTokens,
        estimatedCost,
        statusCode: 200,
      });

      return { kind: "complete", response };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError ||
        error instanceof ApiKeyUnbillableAnthropicMessageUsageError ||
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        throw error;
      }

      lastError = error;
      const latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const statusCode = error instanceof UpstreamAnthropicMessagesApiError ? error.status : 500;

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages",
        latencyMs,
        statusCode,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function resolveStreamingTarget(
  request: AnthropicMessageCreateRequest,
  apiKeyId: string,
  targets: ResolvedAnthropicMessagesProviderModel[],
  options: {
    providerOptions?: ProviderRequestOptions;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  },
): Promise<{
  target: ResolvedAnthropicMessagesProviderModel;
  stream: AsyncIterable<string>;
  latencyMs: number;
}> {
  let lastError: unknown;

  for (const target of targets) {
    let attemptStartTime: number | undefined;
    try {
      if (!target.provider.createAnthropicMessageStream) {
        throw new Error(`${target.providerName} does not support Anthropic Messages streaming`);
      }
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        buildAnthropicMessageRequest(request, target, true),
        target,
        targetRequestContext(request, target, options.requestContext),
      );
      const requestOptions = providerRequestOptions(
        options.providerOptions,
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
      );
      attemptStartTime = Date.now();
      const stream = requestOptions
        ? target.provider.createAnthropicMessageStream(prepared.body, requestOptions)
        : target.provider.createAnthropicMessageStream(prepared.body);
      const prefetchedStream = await prefetchFirstStreamChunk(stream);
      return {
        target,
        stream: prefetchedStream,
        latencyMs: Date.now() - attemptStartTime,
      };
    } catch (error) {
      if (
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        throw error;
      }

      lastError = error;
      const latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const statusCode = error instanceof UpstreamAnthropicMessagesApiError ? error.status : 500;

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/messages",
        latencyMs,
        statusCode,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

function buildAnthropicMessageRequest(
  request: AnthropicMessageCreateRequest,
  target: ResolvedAnthropicMessagesProviderModel,
  stream: boolean,
): AnthropicMessageCreateRequest {
  return {
    ...request,
    model: target.upstreamModelId ?? target.modelId,
    max_tokens: request.max_tokens ?? 4096,
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
  rawBody?: string,
): ProviderRequestOptions | undefined {
  const mergedHeaders = mergeProviderRequestHeaders(baseOptions?.headers ?? {}, { headers });
  return Object.keys(mergedHeaders).length > 0 || rawBody !== undefined
    ? { headers: mergedHeaders, ...(rawBody !== undefined ? { rawBody } : {}) }
    : undefined;
}

function rawPassThroughBody(target: ResolvedProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}

async function prefetchFirstStreamChunk(
  stream: AsyncIterable<string>,
): Promise<AsyncIterable<string>> {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();

  return {
    async *[Symbol.asyncIterator]() {
      if (!first.done) {
        yield first.value;
      }
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    },
  };
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
