import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../../providers/types";
import {
  estimateCost,
  getModelPricing,
  resolveChatModel,
  type ResolvedProviderModel,
} from "../../providers/registry";
import {
  assertChatFeaturesSupported,
  requestedChatFeatures,
  UnsupportedChatFeatureError,
} from "../../providers/chat-compat";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

/**
 * Result of a chat completion call.
 * - `stream` requests return the provider's async iterable plus metadata
 *   needed by the router to stream the response and log usage.
 * - non-streaming requests return a normalized OpenAI-compatible response.
 */
export type ChatCompletionResult =
  | {
      kind: "stream";
      stream: AsyncIterable<ChatCompletionChunk>;
      provider: string;
      model: string;
      startTime: number;
      responseModel: string;
    }
  | {
      kind: "complete";
      response: ChatCompletionResponse;
    };

export class ApiKeyUnbillableUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableUsageError";
  }
}

/**
 * Dispatch a chat completion request to the appropriate provider.
 *
 * Resolves the provider from the requested model name, calls the provider's
 * completion method (streaming or non-streaming), and asynchronously logs the
 * request to the request log buffer.
 *
 * Throws an `Error` if no provider matches the model name, or if the upstream
 * provider call fails. Callers should translate thrown errors into HTTP
 * responses.
 */
export async function handleChatCompletion(
  request: ChatCompletionRequest,
  apiKeyId: string,
  options: { requireBillableUsage?: boolean } = {},
): Promise<ChatCompletionResult> {
  const resolved = await resolveChatModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (
    options.requireBillableUsage &&
    resolved.kind === "direct" &&
    !getModelPricing(resolved.targets[0].publicModelId)
  ) {
    throw new ApiKeyUnbillableUsageError();
  }

  const targets = compatibleTargetsForRequest(
    request,
    resolved.targets,
    resolved.kind === "direct",
  );
  const startTime = Date.now();

  if (request.stream) {
    const selected = await resolveStreamingTarget(request, apiKeyId, targets, startTime);

    // For streaming, hand off the async iterable to the router. The router
    // owns the stream audit lifecycle because usage is only known after chunks
    // have been written to the client.
    return {
      kind: "stream",
      stream: prefixStreamModel(selected.stream, resolved.requestedModelId),
      provider: selected.target.provider.name,
      model: selected.target.publicModelId,
      responseModel: resolved.requestedModelId,
      startTime,
    };
  }

  return handleNonStreamingCompletion(request, apiKeyId, resolved.requestedModelId, targets, {
    requireBillableUsage: options.requireBillableUsage,
    startTime,
  });
}

function compatibleTargetsForRequest(
  request: ChatCompletionRequest,
  targets: ResolvedProviderModel[],
  throwForFirstTarget: boolean,
): ResolvedProviderModel[] {
  const compatible = targets.filter((target) => {
    const model = target.provider.listModels().find((m) => m.id === target.modelId);
    if (!model) return false;

    try {
      assertChatFeaturesSupported(
        request,
        model,
        target.publicModelId,
        target.provider.capabilities,
      );
      return true;
    } catch (error) {
      if (throwForFirstTarget && error instanceof UnsupportedChatFeatureError) {
        throw error;
      }
      return false;
    }
  });

  if (compatible.length === 0) {
    throw new UnsupportedChatFeatureError(
      targets[0]?.publicModelId ?? request.model,
      Array.from(requestedChatFeatures(request)),
    );
  }

  return compatible;
}

async function handleNonStreamingCompletion(
  request: ChatCompletionRequest,
  apiKeyId: string,
  responseModelId: string,
  targets: ResolvedProviderModel[],
  options: { requireBillableUsage?: boolean; startTime: number },
): Promise<ChatCompletionResult> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await target.provider.chatCompletion({ ...request, model: target.modelId });
      const latencyMs = Date.now() - options.startTime;
      const estimatedCost = estimateCost(
        target.publicModelId,
        response.usage?.prompt_tokens,
        response.usage?.completion_tokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: target.provider.name,
          model: target.publicModelId,
          endpoint: "/v1/chat/completions",
          latencyMs,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens,
          statusCode: 429,
          errorMessage: "Billable usage could not be determined",
        });
        throw new ApiKeyUnbillableUsageError();
      }

      if (options.requireBillableUsage && estimatedCost !== undefined) {
        await addApiKeySpendUsd(apiKeyId, estimatedCost);
      }

      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/chat/completions",
        latencyMs,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        estimatedCost,
        statusCode: 200,
      });

      return { kind: "complete", response: { ...response, model: responseModelId } };
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      if (error instanceof ApiKeySpendLedgerUnavailableError) {
        throw error;
      }

      if (error instanceof ApiKeyUnbillableUsageError) {
        throw error;
      }

      lastError = error;
      const latencyMs = Date.now() - options.startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Log the failed concrete attempt before trying the next fallback target.
      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/chat/completions",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function resolveStreamingTarget(
  request: ChatCompletionRequest,
  apiKeyId: string,
  targets: ResolvedProviderModel[],
  startTime: number,
): Promise<{ target: ResolvedProviderModel; stream: AsyncIterable<ChatCompletionChunk> }> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const stream = target.provider.chatCompletionStream({ ...request, model: target.modelId });
      return { target, stream: await prefetchFirstStreamChunk(stream) };
    } catch (error) {
      lastError = error;
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/chat/completions",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function prefetchFirstStreamChunk(
  stream: AsyncIterable<ChatCompletionChunk>,
): Promise<AsyncIterable<ChatCompletionChunk>> {
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

async function* prefixStreamModel(
  stream: AsyncIterable<ChatCompletionChunk>,
  publicModelId: string,
): AsyncIterable<ChatCompletionChunk> {
  for await (const chunk of stream) {
    yield { ...chunk, model: publicModelId };
  }
}
