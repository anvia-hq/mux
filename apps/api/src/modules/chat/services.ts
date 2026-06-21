import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../../providers/types";
import { estimateCost, getModelPricing, resolveProviderModel } from "../../providers/registry";
import { logRequest } from "../../middleware/logger";

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
  const resolved = resolveProviderModel(request.model);

  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (options.requireBillableUsage && !getModelPricing(request.model)) {
    throw new ApiKeyUnbillableUsageError();
  }

  const providerRequest = { ...request, model: resolved.modelId };
  const startTime = Date.now();

  try {
    if (request.stream) {
      // For streaming, hand off the async iterable to the router. The router
      // owns writing chunks to the wire and will call logRequest() once the
      // stream finishes (or fails) so usage can be recorded.
      return {
        kind: "stream",
        stream: prefixStreamModel(
          resolved.provider.chatCompletionStream(providerRequest),
          resolved.publicModelId,
        ),
        provider: resolved.provider.name,
        model: resolved.publicModelId,
        startTime,
      };
    }

    const response = await resolved.provider.chatCompletion(providerRequest);
    const latencyMs = Date.now() - startTime;
    const estimatedCost = estimateCost(
      request.model,
      response.usage?.prompt_tokens,
      response.usage?.completion_tokens,
    );

    if (options.requireBillableUsage && estimatedCost === undefined) {
      throw new ApiKeyUnbillableUsageError();
    }

    // Buffer log entry; flushed asynchronously by the logger middleware.
    logRequest({
      apiKeyId,
      provider: resolved.provider.name,
      model: resolved.publicModelId,
      endpoint: "/v1/chat/completions",
      latencyMs,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      estimatedCost,
      statusCode: 200,
    });

    return { kind: "complete", response: { ...response, model: resolved.publicModelId } };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log the failure so it is visible in admin stats. Streaming errors are
    // also logged by the router when the iterable errors mid-flight.
    logRequest({
      apiKeyId,
      provider: resolved.provider.name,
      model: resolved.publicModelId,
      endpoint: "/v1/chat/completions",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}

async function* prefixStreamModel(
  stream: AsyncIterable<ChatCompletionChunk>,
  publicModelId: string,
): AsyncIterable<ChatCompletionChunk> {
  for await (const chunk of stream) {
    yield { ...chunk, model: publicModelId };
  }
}
