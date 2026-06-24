import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { UpstreamResponsesApiError } from "../../providers/openai";
import {
  estimateCost,
  getModelPricing,
  getProviderByName,
  resolveChatModel,
  resolveResponseTarget,
  type ResolvedProviderModel,
} from "../../providers/registry";
import type { ResponseCompactRequest, ResponseCreateRequest, ResponseObject } from "../../providers/types";
import { prisma } from "../../utils/prisma";
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
  "stream_options",
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
    throw new UnsupportedResponseFeatureError(
      "Responses background mode is handled by submitBackgroundResponse, not handleResponseCreate",
    );
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
    const cachedTokens = readCachedTokens(usage);
    const reasoningTokens = readReasoningTokens(usage);
    const estimatedCost = estimateCost(
      target.publicModelId,
      usage?.input_tokens,
      usage?.output_tokens,
      cachedTokens,
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
        reasoningTokens,
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
      reasoningTokens,
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
    throw new UnsupportedResponseFeatureError(
      "Responses background mode cannot be combined with streaming",
    );
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

export async function submitBackgroundResponse(
  request: ResponseCreateRequest,
  apiKeyId: string,
): Promise<{ id: string; response: ResponseObject }> {
  const { requestedModelId, target } = await resolveOpenAIResponseTarget(request);

  if (!target.provider.createResponse) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support the Responses API",
    );
  }

  const startTime = Date.now();
  let response: ResponseObject;

  try {
    response = await target.provider.createResponse(
      buildOpenAIResponseCreateRequest(request, target),
    );
  } catch (error) {
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

  const latencyMs = Date.now() - startTime;

  const upstreamId = typeof response.id === "string" ? response.id : null;
  if (!upstreamId) {
    throw new Error("Upstream provider did not return a response id");
  }

  const upstreamStatus =
    typeof response.status === "string" ? response.status : "queued";

  await prisma.backgroundResponseJob.create({
    data: {
      id: upstreamId,
      apiKeyId,
      provider: target.provider.name,
      model: target.publicModelId,
      request: request as object,
      status: upstreamStatus,
      response: response as object,
    },
  });

  await logRequest({
    apiKeyId,
    provider: target.provider.name,
    model: target.publicModelId,
    endpoint: "/v1/responses",
    latencyMs,
    statusCode: 202,
  });

  return {
    id: upstreamId,
    response: withPublicModelId(response, requestedModelId),
  };
}

export class OpenAIResponseProviderNotConfiguredError extends Error {
  constructor() {
    super("OpenAI provider is not configured");
    this.name = "OpenAIResponseProviderNotConfiguredError";
  }
}

export class ResponseNotFoundError extends Error {
  constructor(id: string) {
    super(`Response not found: ${id}`);
    this.name = "ResponseNotFoundError";
  }
}

export async function handleResponseRetrieve(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<ResponseObject> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    if (localRow.response !== null && localRow.response !== undefined) {
      const startTime = Date.now();
      const latencyMs = Date.now() - startTime;
      await logRequest({
        apiKeyId,
        provider: localRow.provider,
        model: localRow.model,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 200,
      });
      return localRow.response as ResponseObject;
    }

    return {
      id: localRow.id,
      object: "response",
      status: localRow.status,
      _pending: true,
    } as ResponseObject;
  }

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

export async function handleResponseInputItems(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const openai = getProviderByName("openai");
  const azure = getProviderByName("azure-cognitive-services");
  const candidates = [openai, azure].filter(
    (provider): provider is NonNullable<typeof provider> =>
      Boolean(provider?.listResponseInputItems),
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.listResponseInputItems!(id, query);
      const latencyMs = Date.now() - startTime;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id/input_items",
        latencyMs,
        statusCode: 200,
      });

      return { provider: provider.name, model: provider.name, response };
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  // Every configured provider returned 404.
  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id/input_items",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseInputTokens(
  body: ResponseCreateRequest,
  apiKeyId: string,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const openai = getProviderByName("openai");
  const azure = getProviderByName("azure-cognitive-services");
  const candidates = [openai, azure].filter(
    (provider): provider is NonNullable<typeof provider> =>
      Boolean(provider?.countResponseInputTokens),
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.countResponseInputTokens!(body);
      const latencyMs = Date.now() - startTime;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: typeof body.model === "string" ? body.model : provider.name,
        endpoint: "/v1/responses/input_tokens",
        latencyMs,
        statusCode: 200,
      });

      return {
        provider: provider.name,
        model: typeof body.model === "string" ? body.model : provider.name,
        response,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  // Every configured provider returned 404.
  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: typeof body.model === "string" ? body.model : "unknown",
    endpoint: "/v1/responses/input_tokens",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(`(model: ${typeof body.model === "string" ? body.model : "unknown"})`);
}

async function resolveOpenAIResponseTarget(
  request: ResponseCreateRequest,
): Promise<{ requestedModelId: string; target: ResolvedProviderModel }> {
  const resolved = await resolveResponseTarget(request.model);
  if (!resolved) {
    if (await resolveChatModel(request.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support the Responses API",
      );
    }
    throw new Error(`No provider found for model: ${request.model}`);
  }

  return { requestedModelId: resolved.requestedModelId, target: resolved.target };
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

function readCachedTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as { input_tokens_details?: unknown }).input_tokens_details;
  if (!details || typeof details !== "object") return undefined;
  const cached = (details as { cached_tokens?: unknown }).cached_tokens;
  return typeof cached === "number" && Number.isFinite(cached) ? cached : undefined;
}

export function readReasoningTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as { output_tokens_details?: unknown }).output_tokens_details;
  if (!details || typeof details !== "object") return undefined;
  const reasoning = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
  return typeof reasoning === "number" && Number.isFinite(reasoning) ? reasoning : undefined;
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

export async function handleResponseCancel(
  id: string,
  apiKeyId: string,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    return cancelLocalBackgroundJob(localRow, id, apiKeyId);
  }

  const openai = getProviderByName("openai");
  const azure = getProviderByName("azure-cognitive-services");
  const candidates = [openai, azure].filter(
    (provider): provider is NonNullable<typeof provider> =>
      Boolean(provider?.cancelResponse),
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.cancelResponse!(id);
      const latencyMs = Date.now() - startTime;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id/cancel",
        latencyMs,
        statusCode: 200,
      });

      return { provider: provider.name, model: provider.name, response };
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  // Every configured provider returned 404.
  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id/cancel",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

type LocalBackgroundRow = {
  id: string;
  apiKeyId: string;
  provider: string;
  model: string;
  status: string;
  response: unknown;
};

async function cancelLocalBackgroundJob(
  row: LocalBackgroundRow,
  id: string,
  apiKeyId: string,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const startTime = Date.now();

  const provider = getProviderByName(row.provider);
  let upstreamResponse: ResponseObject | null = null;
  let upstreamNotFound = false;

  if (provider?.cancelResponse) {
    try {
      upstreamResponse = await provider.cancelResponse(id);
    } catch (error) {
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        upstreamNotFound = true;
      } else {
        throw error;
      }
    }
  }

  const now = new Date();
  const merged: ResponseObject = {
    ...((upstreamResponse as object | null) ??
      (row.response as object | null) ??
      {}),
    id: row.id,
    object: "response",
    status: "cancelled",
  };

  await prisma.backgroundResponseJob.update({
    where: { id: row.id },
    data: {
      status: "cancelled",
      response: merged as object,
      completedAt: now,
      ...(upstreamNotFound ? { errorMessage: "upstream 404 on cancel" } : {}),
    },
  });

  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: row.provider,
    model: row.model,
    endpoint: "/v1/responses/:id/cancel",
    latencyMs,
    statusCode: 200,
  });

  return { provider: row.provider, model: row.model, response: merged };
}

export async function handleResponseCompact(
  request: ResponseCompactRequest,
  apiKeyId: string,
  options: { requireBillableUsage?: boolean } = {},
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const resolved = await resolveResponseTarget(request.model);
  if (!resolved) {
    if (await resolveChatModel(request.model)) {
      throw new UnsupportedResponseFeatureError(
        "Selected model does not support the Responses API",
      );
    }
    throw new Error(`No provider found for model: ${request.model}`);
  }

  const primary = resolved.target;
  const primaryProvider = primary.providerName === "openai" ? "openai" : primary.providerName;
  const candidates: Array<{ provider: typeof primary.provider; providerName: string }> = [
    { provider: primary.provider, providerName: primaryProvider },
  ];

  const azure = primary.providerName !== "azure-cognitive-services"
    ? getProviderByName("azure-cognitive-services")
    : null;
  if (azure?.compactResponse) {
    candidates.push({ provider: azure, providerName: "azure-cognitive-services" });
  }

  if (options.requireBillableUsage && !getModelPricing(resolved.requestedModelId)) {
    throw new ApiKeyUnbillableResponseUsageError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const candidate of candidates) {
    if (!candidate.provider.compactResponse) continue;
    try {
      const response = await candidate.provider.compactResponse(
        buildProviderCompactRequest(request, primary),
      );
      const latencyMs = Date.now() - startTime;
      const usage = response.usage;
      const cachedTokens = readCachedTokens(usage);
      const reasoningTokens = readReasoningTokens(usage);
      const estimatedCost = estimateCost(
        resolved.requestedModelId,
        usage?.input_tokens,
        usage?.output_tokens,
        cachedTokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: candidate.providerName,
          model: resolved.requestedModelId,
          endpoint: "/v1/responses/compact",
          latencyMs,
          promptTokens: usage?.input_tokens,
          completionTokens: usage?.output_tokens,
          totalTokens: usage?.total_tokens,
          reasoningTokens,
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
        provider: candidate.providerName,
        model: resolved.requestedModelId,
        endpoint: "/v1/responses/compact",
        latencyMs,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: usage?.total_tokens,
        reasoningTokens,
        estimatedCost,
        statusCode: 200,
      });

      return {
        provider: candidate.providerName,
        model: resolved.requestedModelId,
        response,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof ApiKeyUnbillableResponseUsageError) throw error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
  }

  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/compact",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(request.model);
}

function buildProviderCompactRequest(
  request: ResponseCompactRequest,
  target: ResolvedProviderModel,
): ResponseCompactRequest {
  return { ...request, model: target.modelId };
}
