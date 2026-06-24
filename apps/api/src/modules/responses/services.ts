import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import {
  estimateCost,
  getModelPricing,
  getProviderByName,
  resolveChatModel,
  type ResolvedProviderModel,
} from "../../providers/registry";
import type { ResponseCreateRequest, ResponseObject } from "../../providers/types";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

const RESPONSE_CREATE_FIELDS = [
  "background",
  "conversation",
  "include",
  "input",
  "instructions",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "model",
  "parallel_tool_calls",
  "previous_response_id",
  "prompt",
  "prompt_cache_key",
  "reasoning",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

export class UnsupportedResponseFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedResponseFeatureError";
  }
}

export class ApiKeyUnbillableResponseUsageError extends Error {
  constructor() {
    super(
      "API key spend limit requires billable usage, but this response request cost could not be determined",
    );
    this.name = "ApiKeyUnbillableResponseUsageError";
  }
}

export type ResponseStreamResult = {
  stream: AsyncIterable<string>;
  provider: string;
  model: string;
  startTime: number;
};

export async function handleResponseCreate(
  request: ResponseCreateRequest,
  apiKeyId: string,
  options: { requireBillableUsage?: boolean } = {},
): Promise<ResponseObject> {
  if (request.stream === true) {
    throw new UnsupportedResponseFeatureError("Responses streaming is not supported yet");
  }

  if (request.background === true) {
    throw new UnsupportedResponseFeatureError("Responses background mode is not supported yet");
  }

  const { requestedModelId, target } = await resolveOpenAIResponseTarget(request);

  if (!target.provider.createResponse) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support the Responses API",
    );
  }

  if (options.requireBillableUsage && !getModelPricing(requestedModelId)) {
    throw new ApiKeyUnbillableResponseUsageError();
  }

  const startTime = Date.now();

  try {
    const response = await target.provider.createResponse(
      buildOpenAIResponseCreateRequest(request, target),
    );
    const latencyMs = Date.now() - startTime;
    const usage = response.usage;
    const estimatedCost = estimateCost(
      target.publicModelId,
      usage?.input_tokens,
      usage?.output_tokens,
    );

    if (options.requireBillableUsage && estimatedCost === undefined) {
      await logRequest({
        apiKeyId,
        provider: target.provider.name,
        model: target.publicModelId,
        endpoint: "/v1/responses",
        latencyMs,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: usage?.total_tokens,
        statusCode: 429,
        errorMessage: "Billable usage could not be determined",
      });
      throw new ApiKeyUnbillableResponseUsageError();
    }

    if (options.requireBillableUsage && estimatedCost !== undefined) {
      await addApiKeySpendUsd(apiKeyId, estimatedCost);
    }

    await logRequest({
      apiKeyId,
      provider: target.provider.name,
      model: target.publicModelId,
      endpoint: "/v1/responses",
      latencyMs,
      promptTokens: usage?.input_tokens,
      completionTokens: usage?.output_tokens,
      totalTokens: usage?.total_tokens,
      estimatedCost,
      statusCode: 200,
    });

    return withPublicModelId(response, requestedModelId);
  } catch (error) {
    if (error instanceof RequestLoggingUnavailableError) {
      throw error;
    }

    if (error instanceof ApiKeySpendLedgerUnavailableError) {
      throw error;
    }

    if (error instanceof ApiKeyUnbillableResponseUsageError) {
      throw error;
    }

    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await logRequest({
      apiKeyId,
      provider: target.provider.name,
      model: target.publicModelId,
      endpoint: "/v1/responses",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}

export async function handleResponseCreateStream(
  request: ResponseCreateRequest,
): Promise<ResponseStreamResult> {
  if (request.background === true) {
    throw new UnsupportedResponseFeatureError("Responses background mode is not supported yet");
  }

  const { target } = await resolveOpenAIResponseTarget(request);
  if (!target.provider.createResponseStream) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support Responses streaming",
    );
  }

  const startTime = Date.now();
  const stream = target.provider.createResponseStream(
    buildOpenAIResponseCreateRequest({ ...request, stream: true }, target),
  );

  return {
    stream: await prefetchFirstResponseStreamChunk(stream),
    provider: target.provider.name,
    model: target.publicModelId,
    startTime,
  };
}

export class OpenAIResponseProviderNotConfiguredError extends Error {
  constructor() {
    super("OpenAI provider is not configured");
    this.name = "OpenAIResponseProviderNotConfiguredError";
  }
}

export async function handleResponseRetrieve(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<ResponseObject> {
  const provider = getProviderByName("openai");
  if (!provider) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  if (!provider.getResponse) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response retrieval",
    );
  }

  const startTime = Date.now();

  try {
    const response = await provider.getResponse(id, query);
    const latencyMs = Date.now() - startTime;

    await logRequest({
      apiKeyId,
      provider: provider.name,
      model: "openai",
      endpoint: "/v1/responses/:id",
      latencyMs,
      statusCode: 200,
    });

    return response;
  } catch (error) {
    if (error instanceof RequestLoggingUnavailableError) {
      throw error;
    }

    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await logRequest({
      apiKeyId,
      provider: provider.name,
      model: "openai",
      endpoint: "/v1/responses/:id",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}

export async function handleResponseDelete(id: string, apiKeyId: string): Promise<ResponseObject> {
  const provider = getProviderByName("openai");
  if (!provider) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  if (!provider.deleteResponse) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response deletion",
    );
  }

  const startTime = Date.now();

  try {
    const response = await provider.deleteResponse(id);
    const latencyMs = Date.now() - startTime;

    await logRequest({
      apiKeyId,
      provider: provider.name,
      model: "openai",
      endpoint: "/v1/responses/:id",
      latencyMs,
      statusCode: 200,
    });

    return response;
  } catch (error) {
    if (error instanceof RequestLoggingUnavailableError) {
      throw error;
    }

    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await logRequest({
      apiKeyId,
      provider: provider.name,
      model: "openai",
      endpoint: "/v1/responses/:id",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}

async function resolveOpenAIResponseTarget(
  request: ResponseCreateRequest,
): Promise<{ requestedModelId: string; target: ResolvedProviderModel }> {
  const resolved = await resolveChatModel(request.model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  if (resolved.kind !== "direct") {
    throw new UnsupportedResponseFeatureError(
      "Responses API is only supported for direct OpenAI models in this release",
    );
  }

  const target = resolved.targets[0];
  if (target.providerName !== "openai") {
    throw new UnsupportedResponseFeatureError(
      "Responses API is only supported for OpenAI models in this release",
    );
  }

  return { requestedModelId: resolved.requestedModelId, target };
}

function buildOpenAIResponseCreateRequest(
  request: ResponseCreateRequest,
  target: ResolvedProviderModel,
): ResponseCreateRequest {
  const body: Record<string, unknown> = {};

  for (const field of RESPONSE_CREATE_FIELDS) {
    if (Object.hasOwn(request, field)) {
      body[field] = request[field];
    }
  }

  body.model = target.modelId;
  return body as ResponseCreateRequest;
}

function withPublicModelId(response: ResponseObject, publicModelId: string): ResponseObject {
  if (!Object.hasOwn(response, "model")) return response;
  return { ...response, model: publicModelId };
}

async function prefetchFirstResponseStreamChunk(
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
