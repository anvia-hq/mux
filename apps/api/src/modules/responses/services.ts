import { backoffMs, enqueueBackgroundPoll } from "@repo/worker";
import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import {
  getResponsesCacheTtlSeconds,
  isResponsesCacheEnabled,
  readCachedResponse,
  writeCachedResponse,
} from "../../providers/responses-cache";
import { UpstreamResponsesApiError } from "../../providers/openai";
import {
  estimateCost,
  getModelPricing,
  getProviderByName,
  resolveChatModel,
  resolveResponseTarget,
  type ResolvedProviderModel,
} from "../../providers/registry";
import type {
  ProviderAdapter,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
} from "../../providers/types";
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

const TERMINAL_RESPONSE_STATUSES = new Set(["completed", "cancelled", "failed"]);

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

  if (options.requireBillableUsage && !getModelPricing(target.publicModelId)) {
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
  options: { requireBillableUsage?: boolean } = {},
): Promise<{ id: string; response: ResponseObject }> {
  const { requestedModelId, target } = await resolveOpenAIResponseTarget(request);

  if (!target.provider.createResponse) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support the Responses API",
    );
  }

  const pricing = getModelPricing(target.publicModelId);
  if (options.requireBillableUsage && !pricing) {
    throw new ApiKeyUnbillableResponseUsageError();
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

  const upstreamStatus = typeof response.status === "string" ? response.status : "queued";
  const terminal = isTerminalResponseStatus(upstreamStatus);
  const usage = response.usage;
  const cachedTokens = readCachedTokens(usage);
  const reasoningTokens = readReasoningTokens(usage);
  const estimatedCost =
    terminal && upstreamStatus === "completed"
      ? estimateCost(target.publicModelId, usage?.input_tokens, usage?.output_tokens, cachedTokens)
      : undefined;

  if (options.requireBillableUsage && terminal && upstreamStatus === "completed") {
    if (estimatedCost === undefined) {
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
    await addApiKeySpendUsd(apiKeyId, estimatedCost);
  }

  await prisma.backgroundResponseJob.create({
    data: {
      id: upstreamId,
      apiKeyId,
      provider: target.provider.name,
      model: target.publicModelId,
      request: request as object,
      status: upstreamStatus,
      response: response as object,
      inputPricePer1M: pricing?.inputPricePer1M ?? null,
      outputPricePer1M: pricing?.outputPricePer1M ?? null,
      startedAt: new Date(startTime),
      ...(terminal ? { completedAt: new Date() } : {}),
    },
  });

  if (!terminal) {
    await enqueueBackgroundPoll(upstreamId, 1, backoffMs(1));
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

function responseUtilityProviderCandidates(
  providerNames: string[],
  method: keyof ProviderAdapter,
): ProviderAdapter[] {
  return responseUtilityConfiguredProviders(providerNames).filter((provider) =>
    Boolean(provider[method]),
  );
}

function responseUtilityConfiguredProviders(providerNames: string[]): ProviderAdapter[] {
  const names = process.env.E2E_RESET_TOKEN ? [...providerNames, "e2e"] : providerNames;
  return names
    .map((name) => getProviderByName(name))
    .filter((provider): provider is ProviderAdapter => Boolean(provider));
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
    const startTime = Date.now();
    const pending = !isTerminalResponseStatus(localRow.status);
    const body = buildLocalBackgroundResponse(localRow);
    const latencyMs = Date.now() - startTime;
    await logRequest({
      apiKeyId,
      provider: localRow.provider,
      model: localRow.model,
      endpoint: "/v1/responses/:id",
      latencyMs,
      statusCode: pending ? 202 : 200,
    });

    if (pending) {
      return { ...body, _pending: true } as ResponseObject;
    }

    return body;
  }

  if (isResponsesCacheEnabled()) {
    const cached = await readCachedResponse(apiKeyId, "openai", id);
    if (cached) {
      return cached;
    }
  }

  const configuredProviders = responseUtilityConfiguredProviders(["openai"]);
  if (configuredProviders.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }
  const candidates = configuredProviders.filter((provider) => Boolean(provider.getResponse));
  if (candidates.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response retrieval",
    );
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.getResponse?.(id, query);
      if (!response) continue;
      const latencyMs = Date.now() - startTime;

      if (isResponsesCacheEnabled()) {
        await writeCachedResponse(
          apiKeyId,
          provider.name,
          id,
          response,
          getResponsesCacheTtlSeconds(),
        );
      }

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 200,
      });

      return response;
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      lastError = error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }

      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });

      throw error;
    }
  }

  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseDelete(id: string, apiKeyId: string): Promise<ResponseObject> {
  const localRow = await prisma.backgroundResponseJob.findUnique({
    where: { id },
  });

  if (localRow) {
    return deleteLocalBackgroundJob(localRow, id, apiKeyId);
  }

  const configuredProviders = responseUtilityConfiguredProviders(["openai"]);
  if (configuredProviders.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }
  const candidates = configuredProviders.filter((provider) => Boolean(provider.deleteResponse));
  if (candidates.length === 0) {
    throw new UnsupportedResponseFeatureError(
      "Selected provider does not support response deletion",
    );
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.deleteResponse?.(id);
      if (!response) continue;
      const latencyMs = Date.now() - startTime;

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 200,
      });

      return response;
    } catch (error) {
      if (error instanceof RequestLoggingUnavailableError) {
        throw error;
      }

      lastError = error;
      if (error instanceof UpstreamResponsesApiError && error.status === 404) {
        continue;
      }

      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await logRequest({
        apiKeyId,
        provider: provider.name,
        model: provider.name,
        endpoint: "/v1/responses/:id",
        latencyMs,
        statusCode: 500,
        errorMessage,
      });

      throw error;
    }
  }

  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: "unknown",
    model: "unknown",
    endpoint: "/v1/responses/:id",
    latencyMs,
    statusCode: 404,
    errorMessage: lastError instanceof Error ? lastError.message : "Response not found",
  });
  throw new ResponseNotFoundError(id);
}

export async function handleResponseInputItems(
  id: string,
  apiKeyId: string,
  query?: Record<string, string | string[]>,
): Promise<{ provider: string; model: string; response: ResponseObject }> {
  const candidates = responseUtilityProviderCandidates(
    ["openai", "azure-cognitive-services"],
    "listResponseInputItems",
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.listResponseInputItems?.(id, query);
      if (!response) continue;
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
  const candidates = responseUtilityProviderCandidates(
    ["openai", "azure-cognitive-services"],
    "countResponseInputTokens",
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.countResponseInputTokens?.(body);
      if (!response) continue;
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
  throw new ResponseNotFoundError(
    `(model: ${typeof body.model === "string" ? body.model : "unknown"})`,
  );
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

  const candidates = responseUtilityProviderCandidates(
    ["openai", "azure-cognitive-services"],
    "cancelResponse",
  );

  if (candidates.length === 0) {
    throw new OpenAIResponseProviderNotConfiguredError();
  }

  const startTime = Date.now();
  let lastError: unknown = null;

  for (const provider of candidates) {
    try {
      const response = await provider.cancelResponse?.(id);
      if (!response) continue;
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
  request?: unknown;
  status: string;
  response: unknown;
};

function isTerminalResponseStatus(status: string): boolean {
  return TERMINAL_RESPONSE_STATUSES.has(status);
}

function buildLocalBackgroundResponse(row: LocalBackgroundRow): ResponseObject {
  const response =
    row.response !== null && typeof row.response === "object" ? (row.response as object) : {};
  return {
    ...response,
    id: row.id,
    model: readRequestedModel(row) ?? row.model,
    object: "response",
    status: row.status,
  } as ResponseObject;
}

function readRequestedModel(row: LocalBackgroundRow): string | undefined {
  if (!row.request || typeof row.request !== "object") return undefined;
  const model = (row.request as { model?: unknown }).model;
  return typeof model === "string" ? model : undefined;
}

function isUpstreamNotFoundError(error: unknown): boolean {
  if (error instanceof UpstreamResponsesApiError && error.status === 404) {
    return true;
  }
  return error instanceof Error && /Responses API error: 404\b/.test(error.message);
}

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
      if (isUpstreamNotFoundError(error)) {
        upstreamNotFound = true;
      } else {
        throw error;
      }
    }
  }

  const now = new Date();
  const merged: ResponseObject = {
    ...((upstreamResponse as object | null) ?? (row.response as object | null) ?? {}),
    id: row.id,
    model: readRequestedModel(row) ?? row.model,
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

async function deleteLocalBackgroundJob(
  row: LocalBackgroundRow,
  id: string,
  apiKeyId: string,
): Promise<ResponseObject> {
  const startTime = Date.now();

  const provider = getProviderByName(row.provider);
  if (provider?.deleteResponse) {
    try {
      await provider.deleteResponse(id);
    } catch (error) {
      if (!isUpstreamNotFoundError(error)) {
        throw error;
      }
    }
  }

  await prisma.backgroundResponseJob.delete({
    where: { id: row.id },
  });

  const latencyMs = Date.now() - startTime;
  await logRequest({
    apiKeyId,
    provider: row.provider,
    model: row.model,
    endpoint: "/v1/responses/:id",
    latencyMs,
    statusCode: 200,
  });

  return {
    id: row.id,
    object: "response",
    deleted: true,
  } as ResponseObject;
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

  const azure =
    primary.providerName !== "azure-cognitive-services"
      ? getProviderByName("azure-cognitive-services")
      : null;
  if (azure?.compactResponse) {
    candidates.push({ provider: azure, providerName: "azure-cognitive-services" });
  }

  if (options.requireBillableUsage && !getModelPricing(primary.publicModelId)) {
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
        primary.publicModelId,
        usage?.input_tokens,
        usage?.output_tokens,
        cachedTokens,
      );

      if (options.requireBillableUsage && estimatedCost === undefined) {
        await logRequest({
          apiKeyId,
          provider: candidate.providerName,
          model: primary.publicModelId,
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
        model: primary.publicModelId,
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
