import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleStatusCode } from "../../providers/openai-compatible-error";
import {
  estimateCost,
  resolveAudioSpeechModel,
  resolveAudioSpeechStreamModel,
  resolveAudioTranscriptionModel,
  resolveAudioTranscriptionStreamModel,
  resolveAudioTranslationModel,
  type ResolvedAudioSpeechProviderModel,
  type ResolvedAudioSpeechStreamProviderModel,
  type ResolvedAudioTranscriptionProviderModel,
  type ResolvedAudioTranscriptionStreamProviderModel,
  type ResolvedAudioTranslationProviderModel,
} from "../../providers/registry";
import type {
  AudioMultipartRequest,
  AudioProxyResponse,
  AudioProxyStreamChunk,
  AudioProxyStreamResponse,
  AudioSpeechRequest,
} from "../../providers/types";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

type AudioMultipartTarget =
  | ResolvedAudioTranscriptionProviderModel
  | ResolvedAudioTranslationProviderModel;

type AudioMultipartStreamTarget = ResolvedAudioTranscriptionStreamProviderModel;

export type AudioEndpoint =
  | "/v1/audio/transcriptions"
  | "/v1/audio/translations"
  | "/v1/audio/speech";

export type AudioTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AudioProxyStreamResult = {
  stream: AsyncIterable<AudioProxyStreamChunk>;
  contentType?: string;
  provider: string;
  model: string;
  channelId?: string;
  channelName?: string;
  latencyMs: number;
};

export async function handleAudioTranscription(
  formData: FormData,
  model: string,
  apiKeyId: string,
  options: { recordSpend?: boolean } = {},
): Promise<AudioProxyResponse> {
  const resolved = await resolveAudioTranscriptionModel(model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${model}`);
  }

  return createAudioMultipartWithFallback(
    formData,
    model,
    apiKeyId,
    resolved.targets,
    "/v1/audio/transcriptions",
    (target, request) => target.provider.createAudioTranscription(request),
    { recordSpend: options.recordSpend },
  );
}

export async function handleAudioTranscriptionStream(
  formData: FormData,
  model: string,
  apiKeyId: string,
): Promise<AudioProxyStreamResult> {
  const resolved = await resolveAudioTranscriptionStreamModel(model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${model}`);
  }

  return createAudioMultipartStreamWithFallback(
    formData,
    model,
    apiKeyId,
    resolved.targets,
    "/v1/audio/transcriptions",
    (target, request) => target.provider.createAudioTranscriptionStream(request),
  );
}

export async function handleAudioTranslation(
  formData: FormData,
  model: string,
  apiKeyId: string,
  options: { recordSpend?: boolean } = {},
): Promise<AudioProxyResponse> {
  const resolved = await resolveAudioTranslationModel(model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${model}`);
  }

  return createAudioMultipartWithFallback(
    formData,
    model,
    apiKeyId,
    resolved.targets,
    "/v1/audio/translations",
    (target, request) => target.provider.createAudioTranslation(request),
    { recordSpend: options.recordSpend },
  );
}

export async function handleAudioSpeech(
  request: AudioSpeechRequest,
  apiKeyId: string,
  options: { recordSpend?: boolean } = {},
): Promise<AudioProxyResponse> {
  const resolved = await resolveAudioSpeechModel(request.model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  return createAudioSpeechWithFallback(request, apiKeyId, resolved.targets, {
    recordSpend: options.recordSpend,
  });
}

export async function handleAudioSpeechStream(
  request: AudioSpeechRequest,
  apiKeyId: string,
): Promise<AudioProxyStreamResult> {
  const resolved = await resolveAudioSpeechStreamModel(request.model);
  if (!resolved) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  return createAudioSpeechStreamWithFallback(request, apiKeyId, resolved.targets);
}

async function createAudioMultipartWithFallback<TTarget extends AudioMultipartTarget>(
  formData: FormData,
  requestedModel: string,
  apiKeyId: string,
  targets: TTarget[],
  endpoint: AudioEndpoint,
  createAudio: (target: TTarget, request: AudioMultipartRequest) => Promise<AudioProxyResponse>,
  options: { recordSpend?: boolean },
): Promise<AudioProxyResponse> {
  let lastError: unknown;

  for (const target of targets) {
    const attemptStartTime = Date.now();
    try {
      const response = await createAudio(target, {
        model: targetUpstreamModelId(target),
        formData,
      });
      const latencyMs = Date.now() - attemptStartTime;
      await recordSuccessfulAudioRequest(
        response,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        endpoint,
        { recordSpend: options.recordSpend, latencyMs },
      );
      return response;
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        throw error;
      }

      lastError = error;
      await logFailedAudioRequest(
        error,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        endpoint,
        attemptStartTime,
      );
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${requestedModel}`);
}

async function createAudioMultipartStreamWithFallback<TTarget extends AudioMultipartStreamTarget>(
  formData: FormData,
  requestedModel: string,
  apiKeyId: string,
  targets: TTarget[],
  endpoint: AudioEndpoint,
  createAudio: (
    target: TTarget,
    request: AudioMultipartRequest,
  ) => Promise<AudioProxyStreamResponse>,
): Promise<AudioProxyStreamResult> {
  let lastError: unknown;

  for (const target of targets) {
    const attemptStartTime = Date.now();
    try {
      const response = await createAudio(target, {
        model: targetUpstreamModelId(target),
        formData,
      });

      const stream = await prefetchFirstStreamChunk(response.stream);
      return {
        stream,
        contentType: response.contentType,
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        latencyMs: Date.now() - attemptStartTime,
      };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        throw error;
      }

      lastError = error;
      await logFailedAudioRequest(
        error,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        endpoint,
        attemptStartTime,
      );
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${requestedModel}`);
}

async function createAudioSpeechWithFallback(
  request: AudioSpeechRequest,
  apiKeyId: string,
  targets: ResolvedAudioSpeechProviderModel[],
  options: { recordSpend?: boolean },
): Promise<AudioProxyResponse> {
  let lastError: unknown;

  for (const target of targets) {
    const attemptStartTime = Date.now();
    try {
      const response = await target.provider.createAudioSpeech({
        ...request,
        model: targetUpstreamModelId(target),
      });
      const latencyMs = Date.now() - attemptStartTime;
      await recordSuccessfulAudioRequest(
        response,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        "/v1/audio/speech",
        { recordSpend: options.recordSpend, latencyMs },
      );
      return response;
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        throw error;
      }

      lastError = error;
      await logFailedAudioRequest(
        error,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        "/v1/audio/speech",
        attemptStartTime,
      );
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function createAudioSpeechStreamWithFallback(
  request: AudioSpeechRequest,
  apiKeyId: string,
  targets: ResolvedAudioSpeechStreamProviderModel[],
): Promise<AudioProxyStreamResult> {
  let lastError: unknown;

  for (const target of targets) {
    const attemptStartTime = Date.now();
    try {
      const response = await target.provider.createAudioSpeechStream({
        ...request,
        model: targetUpstreamModelId(target),
      });

      const stream = await prefetchFirstStreamChunk(response.stream);
      return {
        stream,
        contentType:
          response.contentType ??
          (request.stream_format === "audio" ? "application/octet-stream" : undefined),
        provider: target.providerName,
        model: target.publicModelId,
        channelId: target.channelId,
        channelName: target.channelName,
        latencyMs: Date.now() - attemptStartTime,
      };
    } catch (error) {
      if (
        error instanceof RequestLoggingUnavailableError ||
        error instanceof ApiKeySpendLedgerUnavailableError
      ) {
        throw error;
      }

      lastError = error;
      await logFailedAudioRequest(
        error,
        apiKeyId,
        target.publicModelId,
        target.providerName,
        target.channelId,
        target.channelName,
        "/v1/audio/speech",
        attemptStartTime,
      );
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${request.model}`);
}

async function recordSuccessfulAudioRequest(
  response: AudioProxyResponse,
  apiKeyId: string,
  model: string,
  provider: string,
  channelId: string | undefined,
  channelName: string | undefined,
  endpoint: AudioEndpoint,
  options: { recordSpend?: boolean; latencyMs: number },
): Promise<void> {
  const usage = extractAudioUsage(response.usage, endpoint);
  const estimatedCost = estimateCost(model, usage.promptTokens, usage.completionTokens);

  if (options.recordSpend && estimatedCost !== undefined) {
    await addApiKeySpendUsd(apiKeyId, estimatedCost);
  }

  await logRequest({
    apiKeyId,
    provider,
    model,
    channelId,
    channelName,
    endpoint,
    latencyMs: options.latencyMs,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCost,
    statusCode: 200,
  });
}

async function logFailedAudioRequest(
  error: unknown,
  apiKeyId: string,
  model: string,
  provider: string,
  channelId: string | undefined,
  channelName: string | undefined,
  endpoint: AudioEndpoint,
  attemptStartTime: number,
): Promise<void> {
  const latencyMs = Date.now() - attemptStartTime;
  const errorMessage = error instanceof Error ? error.message : "Unknown error";

  await logRequest({
    apiKeyId,
    provider,
    model,
    channelId,
    channelName,
    endpoint,
    latencyMs,
    statusCode: upstreamOpenAICompatibleStatusCode(error),
    errorMessage,
  });
}

export function extractAudioUsage(value: unknown, endpoint: AudioEndpoint): AudioTokenUsage {
  const usage = toUsageObject(value);
  if (!usage) return {};

  if (usage.type === "duration") {
    return extractDurationAudioUsage(usage, endpoint);
  }

  const promptTokens =
    numberOrUndefined(usage.prompt_tokens) ??
    numberOrUndefined(usage.input_tokens) ??
    sumUsageDetails(usage.input_token_details);
  const completionTokens =
    numberOrUndefined(usage.completion_tokens) ??
    numberOrUndefined(usage.output_tokens) ??
    sumUsageDetails(usage.output_token_details);
  const totalTokens =
    numberOrUndefined(usage.total_tokens) ?? sumDefinedTokens(promptTokens, completionTokens);

  return { promptTokens, completionTokens, totalTokens };
}

export function extractAudioUsageFromRawSseChunk(
  chunk: string,
  endpoint: AudioEndpoint,
): AudioTokenUsage {
  const result: AudioTokenUsage = {};

  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data: ")) continue;

    const data = line.slice(6);
    if (data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as { usage?: unknown };
      const usage = extractAudioUsage(parsed.usage, endpoint);
      if (usage.promptTokens !== undefined) result.promptTokens = usage.promptTokens;
      if (usage.completionTokens !== undefined) {
        result.completionTokens = usage.completionTokens;
      }
      if (usage.totalTokens !== undefined) result.totalTokens = usage.totalTokens;
    } catch {}
  }

  return result;
}

export function createAudioUsageAccumulator(
  endpoint: AudioEndpoint,
  contentType: string | undefined,
): {
  push: (chunk: AudioProxyStreamChunk) => AudioTokenUsage;
  final: () => AudioTokenUsage;
} {
  const normalizedContentType = contentType?.toLowerCase() ?? "";
  const shouldParseText =
    normalizedContentType.includes("text/") || normalizedContentType.includes("json");
  const shouldParseSse = normalizedContentType.includes("text/event-stream");
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let bodyBuffer = "";

  function extractAudioUsageFromCompleteSseLines(endpoint: AudioEndpoint): AudioTokenUsage {
    const result: AudioTokenUsage = {};
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as { usage?: unknown };
        mergeAudioUsage(result, extractAudioUsage(parsed.usage, endpoint));
      } catch {}
    }

    return result;
  }

  return {
    push(chunk) {
      if (!shouldParseText) return {};

      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (shouldParseSse) {
        lineBuffer += text;
        return extractAudioUsageFromCompleteSseLines(endpoint);
      }

      bodyBuffer += text;
      return {};
    },
    final() {
      if (!shouldParseText) return {};

      const finalText = decoder.decode();
      if (shouldParseSse) {
        lineBuffer += finalText;
        if (lineBuffer.length === 0) return {};

        lineBuffer += "\n";
        return extractAudioUsageFromCompleteSseLines(endpoint);
      }

      bodyBuffer += finalText;
      return extractAudioUsageFromJsonBody(bodyBuffer, endpoint);
    },
  };
}

async function prefetchFirstStreamChunk(
  stream: AsyncIterable<AudioProxyStreamChunk>,
): Promise<AsyncIterable<AudioProxyStreamChunk>> {
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

function targetUpstreamModelId(target: { upstreamModelId?: string; modelId: string }): string {
  return target.upstreamModelId ?? target.modelId;
}

function extractAudioUsageFromJsonBody(body: string, endpoint: AudioEndpoint): AudioTokenUsage {
  try {
    const parsed = JSON.parse(body) as { usage?: unknown };
    return extractAudioUsage(parsed.usage, endpoint);
  } catch {
    return {};
  }
}

function mergeAudioUsage(target: AudioTokenUsage, usage: AudioTokenUsage): void {
  if (usage.promptTokens !== undefined) target.promptTokens = usage.promptTokens;
  if (usage.completionTokens !== undefined) {
    target.completionTokens = usage.completionTokens;
  }
  if (usage.totalTokens !== undefined) target.totalTokens = usage.totalTokens;
}

function extractDurationAudioUsage(
  usage: Record<string, unknown>,
  endpoint: AudioEndpoint,
): AudioTokenUsage {
  const seconds = numberOrUndefined(usage.seconds);
  if (seconds === undefined) return {};

  const tokenEquivalent = Math.round((Math.ceil(seconds) / 60) * 1000);
  if (endpoint === "/v1/audio/speech") {
    return {
      promptTokens: 0,
      completionTokens: tokenEquivalent,
      totalTokens: tokenEquivalent,
    };
  }

  return {
    promptTokens: tokenEquivalent,
    completionTokens: 0,
    totalTokens: tokenEquivalent,
  };
}

function sumUsageDetails(value: unknown): number | undefined {
  const details = toUsageObject(value);
  if (!details) return undefined;

  let total = 0;
  let hasValue = false;
  for (const key of ["text_tokens", "audio_tokens", "image_tokens"] as const) {
    const tokens = numberOrUndefined(details[key]);
    if (tokens === undefined) continue;

    total += tokens;
    hasValue = true;
  }
  return hasValue ? total : undefined;
}

function sumDefinedTokens(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number | undefined {
  if (promptTokens === undefined || completionTokens === undefined) {
    return undefined;
  }
  return promptTokens + completionTokens;
}

function toUsageObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
