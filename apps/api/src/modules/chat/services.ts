import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "../../providers/types";
import { estimateCost, getModelPricing, getProvider } from "../../providers/registry";
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
  const provider = getProvider(request.model);

  if (!provider) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (options.requireBillableUsage && !getModelPricing(request.model)) {
    throw new ApiKeyUnbillableUsageError();
  }

  const startTime = Date.now();

  try {
    if (request.stream) {
      // For streaming, hand off the async iterable to the router. The router
      // owns writing chunks to the wire and will call logRequest() once the
      // stream finishes (or fails) so usage can be recorded.
      return {
        kind: "stream",
        stream: provider.chatCompletionStream(request),
        provider: provider.name,
        model: request.model,
        startTime,
      };
    }

    const response = await provider.chatCompletion(request);
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
      provider: provider.name,
      model: request.model,
      endpoint: "/v1/chat/completions",
      latencyMs,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      estimatedCost,
      statusCode: 200,
    });

    return { kind: "complete", response };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log the failure so it is visible in admin stats. Streaming errors are
    // also logged by the router when the iterable errors mid-flight.
    logRequest({
      apiKeyId,
      provider: provider.name,
      model: request.model,
      endpoint: "/v1/chat/completions",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}
