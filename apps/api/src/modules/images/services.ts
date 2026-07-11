import { logRequest } from "../../middleware/logger";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleStatusCode } from "../../providers/openai-compatible-error";
import type { ImageGenerationRequest, ImageGenerationResponse } from "../../providers/types";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import {
  estimateCost,
  resolveImageGenerationModel,
  type ResolvedImageGenerationProviderModel,
} from "../../providers/registry";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export type ImageGenerationResult =
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
      response: ImageGenerationResponse;
    };

export async function handleImageGeneration(
  request: ImageGenerationRequest,
  apiKeyId: string,
  options: {
    recordSpend?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<ImageGenerationResult> {
  const resolved = await resolveImageGenerationModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
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

  return createImageGenerationWithFallback(request, apiKeyId, resolved.targets, {
    recordSpend: options.recordSpend,
    requestContext: options.requestContext,
    rawBody: options.rawBody,
  });
}

async function createImageGenerationWithFallback(
  request: ImageGenerationRequest,
  apiKeyId: string,
  targets: ResolvedImageGenerationProviderModel[],
  options: {
    recordSpend?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  },
): Promise<ImageGenerationResult> {
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
        ? await target.provider.createImageGeneration(prepared.body, providerOptions)
        : await target.provider.createImageGeneration(prepared.body);
      const latencyMs = Date.now() - attemptStartTime;
      const usage = extractImageGenerationTokenUsage(response);
      const estimatedCost = estimateCost(
        target.publicModelId,
        usage.promptTokens,
        usage.completionTokens,
      );

      if (options.recordSpend && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/images/generations",
        latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        statusCode: 200,
      });

      return { kind: "complete", response };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError ||
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
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/images/generations",
        latencyMs,
        statusCode: upstreamOpenAICompatibleStatusCode(error),
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function resolveStreamingTarget(
  request: ImageGenerationRequest,
  apiKeyId: string,
  targets: ResolvedImageGenerationProviderModel[],
  requestContext?: ChannelOverrideRequestContext,
  rawBody?: string,
): Promise<{
  target: ResolvedImageGenerationProviderModel;
  stream: AsyncIterable<string>;
  latencyMs: number;
}> {
  let lastError: unknown;

  for (const target of targets) {
    let attemptStartTime: number | undefined;
    try {
      if (!target.provider.createImageGenerationStream) {
        throw new Error(`${target.providerName} does not support image generation streaming`);
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
        ? target.provider.createImageGenerationStream(prepared.body, providerOptions)
        : target.provider.createImageGenerationStream(prepared.body);
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
        requestedModel: request.model,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/images/generations",
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
  target: ResolvedImageGenerationProviderModel,
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

function rawPassThroughBody(
  target: ResolvedImageGenerationProviderModel,
  rawBody: string | undefined,
) {
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

export function extractImageGenerationTokenUsage(response: ImageGenerationResponse): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const usage = response.usage;
  if (!usage) return {};

  const promptTokens =
    numberOrUndefined(usage.prompt_tokens) ?? numberOrUndefined(usage.input_tokens);
  const completionTokens =
    numberOrUndefined(usage.completion_tokens) ?? numberOrUndefined(usage.output_tokens);
  const totalTokens = numberOrUndefined(usage.total_tokens);

  return { promptTokens, completionTokens, totalTokens };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
