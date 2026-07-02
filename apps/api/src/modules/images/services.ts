import { logRequest } from "../../middleware/logger";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import type { ImageGenerationRequest, ImageGenerationResponse } from "../../providers/types";
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
      startTime: number;
    }
  | {
      kind: "complete";
      response: ImageGenerationResponse;
    };

export async function handleImageGeneration(
  request: ImageGenerationRequest,
  apiKeyId: string,
  options: { recordSpend?: boolean } = {},
): Promise<ImageGenerationResult> {
  const resolved = await resolveImageGenerationModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  const startTime = Date.now();

  if (request.stream) {
    const selected = await resolveStreamingTarget(request, apiKeyId, resolved.targets, startTime);
    return {
      kind: "stream",
      stream: selected.stream,
      provider: selected.target.provider.name,
      model: selected.target.publicModelId,
      startTime,
    };
  }

  return createImageGenerationWithFallback(request, apiKeyId, resolved.targets, {
    recordSpend: options.recordSpend,
    startTime,
  });
}

async function createImageGenerationWithFallback(
  request: ImageGenerationRequest,
  apiKeyId: string,
  targets: ResolvedImageGenerationProviderModel[],
  options: { recordSpend?: boolean; startTime: number },
): Promise<ImageGenerationResult> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await target.provider.createImageGeneration({
        ...request,
        model: target.modelId,
      });
      const latencyMs = Date.now() - options.startTime;
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
        provider: target.provider.name,
        model: target.publicModelId,
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
        endpoint: "/v1/images/generations",
        latencyMs,
        statusCode: 500,
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
  startTime: number,
): Promise<{ target: ResolvedImageGenerationProviderModel; stream: AsyncIterable<string> }> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      if (!target.provider.createImageGenerationStream) {
        throw new Error(`${target.provider.name} does not support image generation streaming`);
      }
      const stream = target.provider.createImageGenerationStream({
        ...request,
        model: target.modelId,
      });
      return { target, stream: await prefetchFirstStreamChunk(stream) };
    } catch (error) {
      lastError = error;
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/images/generations",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
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
