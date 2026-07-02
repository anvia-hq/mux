import type { EmbeddingRequest, EmbeddingResponse } from "../../providers/types";
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
  options: { requireBillableUsage?: boolean } = {},
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
      startTime: Date.now(),
    },
  );
}

async function createEmbeddingWithFallback(
  request: EmbeddingRequest,
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedEmbeddingProviderModel[],
  options: { requireBillableUsage?: boolean; startTime: number },
): Promise<EmbeddingResponse> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await target.provider.createEmbedding({ ...request, model: target.modelId });
      const latencyMs = Date.now() - options.startTime;
      const estimatedCost = estimateCost(target.publicModelId, response.usage?.prompt_tokens, 0);

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.provider.name,
          model: target.publicModelId,
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
        provider: target.provider.name,
        model: target.publicModelId,
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

      lastError = error;
      const latencyMs = Date.now() - options.startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/embeddings",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}
