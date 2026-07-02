import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import type { ModerationRequest, ModerationResponse } from "../../providers/types";
import { prepareChannelOpenAICompatibleRequestSettings } from "../../providers/channel-settings";
import {
  ChannelHeaderOverrideError,
  ChannelParamOverrideError,
  type ChannelOverrideRequestContext,
} from "../../providers/channel-overrides";
import {
  estimateCost,
  resolveModerationModel,
  type ResolvedModerationProviderModel,
} from "../../providers/registry";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export async function handleModeration(
  request: ModerationRequest & { model: string },
  apiKeyId: string,
  options: {
    recordSpend?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
  } = {},
): Promise<ModerationResponse> {
  const resolved = await resolveModerationModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  return createModerationWithFallback(
    request,
    apiKeyId,
    resolved.requestedModelId,
    resolved.targets,
    {
      recordSpend: options.recordSpend,
      requestContext: options.requestContext,
      rawBody: options.rawBody,
      startTime: Date.now(),
    },
  );
}

async function createModerationWithFallback(
  request: ModerationRequest & { model: string },
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedModerationProviderModel[],
  options: {
    recordSpend?: boolean;
    requestContext?: ChannelOverrideRequestContext;
    rawBody?: string;
    startTime: number;
  },
): Promise<ModerationResponse> {
  let lastError: unknown;

  for (const target of targets) {
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
      const response = providerOptions
        ? await target.provider.createModeration(prepared.body, providerOptions)
        : await target.provider.createModeration(prepared.body);
      const latencyMs = Date.now() - options.startTime;
      const usage = extractTokenUsage(response);
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
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/moderations",
        latencyMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        statusCode: 200,
      });

      return { ...response, model: responseModelId };
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
      const latencyMs = Date.now() - options.startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        endpoint: "/v1/moderations",
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
  target: ResolvedModerationProviderModel,
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

function rawPassThroughBody(target: ResolvedModerationProviderModel, rawBody: string | undefined) {
  return target.settings?.passThroughBodyEnabled ? rawBody : undefined;
}

function extractTokenUsage(response: ModerationResponse): {
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
