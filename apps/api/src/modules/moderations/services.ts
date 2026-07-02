import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import type { ModerationRequest, ModerationResponse } from "../../providers/types";
import {
  estimateCost,
  resolveModerationModel,
  type ResolvedModerationProviderModel,
} from "../../providers/registry";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

export async function handleModeration(
  request: ModerationRequest & { model: string },
  apiKeyId: string,
  options: { recordSpend?: boolean } = {},
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
      startTime: Date.now(),
    },
  );
}

async function createModerationWithFallback(
  request: ModerationRequest & { model: string },
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedModerationProviderModel[],
  options: { recordSpend?: boolean; startTime: number },
): Promise<ModerationResponse> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await target.provider.createModeration({
        ...request,
        model: target.modelId,
      });
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
        provider: target.provider.name,
        model: target.publicModelId,
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
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        throw error;
      }

      lastError = error;
      const latencyMs = Date.now() - options.startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/moderations",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
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
