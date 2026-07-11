import type { EmbeddingRequest, EmbeddingResponse } from "../../providers/types";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import {
  estimateCost,
  getModelPricing,
  resolveEmbeddingModel,
  type ResolvedEmbeddingProviderModel,
} from "../../providers/registry";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export class ApiKeyUnbillableEmbeddingUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableEmbeddingUsageError";
  }
}

export async function handleEmbedding(
  request: EmbeddingRequest,
  apiKeyId: string,
  options: {
    requireBillableUsage?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<EmbeddingResponse> {
  const resolved = await resolveEmbeddingModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (
    options.requireBillableUsage &&
    resolved.kind === "direct" &&
    !getModelPricing(resolved.targets[0].publicModelId)
  ) {
    throw new ApiKeyUnbillableEmbeddingUsageError();
  }

  return createEmbeddingWithFallback(
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

async function createEmbeddingWithFallback(
  request: EmbeddingRequest,
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedEmbeddingProviderModel[],
  options: {
    requireBillableUsage?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  },
): Promise<EmbeddingResponse> {
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
        ? await target.provider.createEmbedding(prepared.body, providerOptions)
        : await target.provider.createEmbedding(prepared.body);
      const latencyMs = Date.now() - attemptStartTime;
      const estimatedCost = estimateCost(target.publicModelId, response.usage?.prompt_tokens, 0);

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.providerName,
          model: target.publicModelId,
          requestedModel: responseModelId,
          channelId: target.channelId,
          channelName: target.channelName,
          endpoint: "/v1/embeddings",
          latencyMs,
          promptTokens: response.usage?.prompt_tokens,
          totalTokens: response.usage?.total_tokens,
          statusCode: 429,
          errorMessage: "Billable usage could not be determined",
        });
        throw new ApiKeyUnbillableEmbeddingUsageError();
      }

      if (options.requireBillableUsage && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        requestedModel: responseModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/embeddings",
        latencyMs,
        promptTokens: response.usage?.prompt_tokens,
        totalTokens: response.usage?.total_tokens,
        estimatedCost,
        statusCode: 200,
      });

      return { ...response, model: responseModelId };
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      if (error instanceof ApiKeySpendLedgerUnavailableError) {
        throw error;
      }

      if (error instanceof ApiKeyUnbillableEmbeddingUsageError) {
        throw error;
      }

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
        requestedModel: responseModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/embeddings",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

function targetRequestContext(
  request: { model: string },
  target: ResolvedEmbeddingProviderModel,
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

function rawPassThroughBody(target: ResolvedEmbeddingProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}
