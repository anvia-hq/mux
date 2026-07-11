import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleStatusCode } from "../../providers/openai-compatible-error";
import type { CompletionRequest, CompletionResponse } from "../../providers/types";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import {
  estimateCost,
  getModelPricing,
  resolveCompletionModel,
  type ResolvedCompletionProviderModel,
} from "../../providers/registry";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export type CompletionResult =
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
      response: CompletionResponse;
    };

export class ApiKeyUnbillableCompletionUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableCompletionUsageError";
  }
}

export async function handleCompletion(
  request: CompletionRequest,
  apiKeyId: string,
  options: {
    requireBillableUsage?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<CompletionResult> {
  const resolved = await resolveCompletionModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (
    options.requireBillableUsage &&
    resolved.kind === "direct" &&
    !getModelPricing(resolved.targets[0].publicModelId)
  ) {
    throw new ApiKeyUnbillableCompletionUsageError();
  }

  if (request.stream) {
    const selected = await resolveStreamingTarget(
      request,
      apiKeyId,
      resolved.targets,
      options.requestContext,
      options.rawBody,
    );
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

  return createCompletionWithFallback(
    request,
    apiKeyId,
    resolved.requestedModelId,
    resolved.targets,
    {
      requireBillableUsage: options.requireBillableUsage,
      requestContext: options.requestContext,
      rawBody: options.rawBody,
    },
  );
}

async function createCompletionWithFallback(
  request: CompletionRequest,
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedCompletionProviderModel[],
  options: {
    requireBillableUsage?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  },
): Promise<CompletionResult> {
  let lastError: unknown;

  for (const target of targets) {
    let attemptStartTime: number | undefined;
    try {
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        { ...request, model: target.upstreamModelId ?? target.modelId },
        target,
        targetRequestContext(request, target, options.requestContext),
      );
      const providerOptions = providerRequestOptions(
        prepared.headers,
        rawPassThroughBody(target, options.rawBody),
      );
      attemptStartTime = Date.now();
      const response = providerOptions
        ? await target.provider.createCompletion(prepared.body, providerOptions)
        : await target.provider.createCompletion(prepared.body);
      const latencyMs = Date.now() - attemptStartTime;
      const usage = extractCompletionTokenUsage(response);
      const estimatedCost = estimateCost(
        target.publicModelId,
        usage.promptTokens,
        usage.completionTokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.providerName,
          model: target.publicModelId,
          channelId: target.channelId,
          channelName: target.channelName,
          endpoint: "/v1/completions",
          latencyMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          statusCode: 429,
          errorMessage: "Billable usage could not be determined",
        });
        throw new ApiKeyUnbillableCompletionUsageError();
      }

      if (options.requireBillableUsage && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/completions",
        latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        statusCode: 200,
      });

      return { kind: "complete", response: { ...response, model: responseModelId } };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError ||
        error instanceof ApiKeyUnbillableCompletionUsageError ||
        error instanceof ChannelParamOverrideError ||
        error instanceof ChannelHeaderOverrideError
      ) {
        throw error;
      }

      lastError = error;
      const latencyMs = attemptStartTime === undefined ? 0 : Date.now() - attemptStartTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/completions",
        latencyMs,
        statusCode: upstreamOpenAICompatibleStatusCode(error),
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function resolveStreamingTarget(
  request: CompletionRequest,
  apiKeyId: string,
  targets: ResolvedCompletionProviderModel[],
  requestContext?: ChannelOverrideRequestContext,
  rawBody?: string,
): Promise<{
  target: ResolvedCompletionProviderModel;
  stream: AsyncIterable<string>;
  latencyMs: number;
}> {
  let lastError: unknown;

  for (const target of targets) {
    let attemptStartTime: number | undefined;
    try {
      if (!target.provider.createCompletionStream) {
        throw new Error(`${target.providerName} does not support completions streaming`);
      }
      const prepared = prepareChannelOpenAICompatibleRequestSettings(
        { ...request, model: target.upstreamModelId ?? target.modelId },
        target,
        targetRequestContext(request, target, requestContext),
      );
      const providerOptions = providerRequestOptions(
        prepared.headers,
        rawPassThroughBody(target, rawBody),
      );
      attemptStartTime = Date.now();
      const stream = providerOptions
        ? target.provider.createCompletionStream(prepared.body, providerOptions)
        : target.provider.createCompletionStream(prepared.body);
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

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/completions",
        latencyMs,
        statusCode: upstreamOpenAICompatibleStatusCode(error),
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

function targetRequestContext(
  request: { model: string },
  target: ResolvedCompletionProviderModel,
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

function providerRequestOptions(headers: Record<string, string>, rawBody?: string) {
  return Object.keys(headers).length > 0 || rawBody !== undefined
    ? { headers, ...(rawBody !== undefined ? { rawBody } : {}) }
    : undefined;
}

function rawPassThroughBody(target: ResolvedCompletionProviderModel, rawBody: string | undefined) {
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

export function extractCompletionTokenUsage(response: CompletionResponse): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const usage = response.usage;
  if (!usage) return {};

  return {
    promptTokens: numberOrUndefined(usage.prompt_tokens),
    completionTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
