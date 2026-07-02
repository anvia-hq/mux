import { logRequest, RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleStatusCode } from "../../providers/openai-compatible-error";
import {
  estimateCost,
  resolveAudioSpeechModel,
  resolveAudioTranscriptionModel,
  resolveAudioTranslationModel,
  type ResolvedAudioSpeechProviderModel,
  type ResolvedAudioTranscriptionProviderModel,
  type ResolvedAudioTranslationProviderModel,
} from "../../providers/registry";
import type {
  AudioMultipartRequest,
  AudioProxyResponse,
  AudioSpeechRequest,
} from "../../providers/types";
import { addApiKeySpendUsd, ApiKeySpendLedgerUnavailableError } from "../keys/services";

type AudioMultipartTarget =
  | ResolvedAudioTranscriptionProviderModel
  | ResolvedAudioTranslationProviderModel;

type AudioEndpoint = "/v1/audio/transcriptions" | "/v1/audio/translations" | "/v1/audio/speech";

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
    { recordSpend: options.recordSpend, startTime: Date.now() },
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
    { recordSpend: options.recordSpend, startTime: Date.now() },
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
    startTime: Date.now(),
  });
}

async function createAudioMultipartWithFallback<TTarget extends AudioMultipartTarget>(
  formData: FormData,
  requestedModel: string,
  apiKeyId: string,
  targets: TTarget[],
  endpoint: AudioEndpoint,
  createAudio: (target: TTarget, request: AudioMultipartRequest) => Promise<AudioProxyResponse>,
  options: { recordSpend?: boolean; startTime: number },
): Promise<AudioProxyResponse> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await createAudio(target, { model: target.modelId, formData });
      await recordSuccessfulAudioRequest(
        response,
        apiKeyId,
        target.publicModelId,
        target.provider.name,
        endpoint,
        options,
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
        target.provider.name,
        endpoint,
        options.startTime,
      );
    }
  }

  throw lastError ?? new Error(`No provider found for model: ${requestedModel}`);
}

async function createAudioSpeechWithFallback(
  request: AudioSpeechRequest,
  apiKeyId: string,
  targets: ResolvedAudioSpeechProviderModel[],
  options: { recordSpend?: boolean; startTime: number },
): Promise<AudioProxyResponse> {
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await target.provider.createAudioSpeech({
        ...request,
        model: target.modelId,
      });
      await recordSuccessfulAudioRequest(
        response,
        apiKeyId,
        target.publicModelId,
        target.provider.name,
        "/v1/audio/speech",
        options,
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
        target.provider.name,
        "/v1/audio/speech",
        options.startTime,
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
  endpoint: AudioEndpoint,
  options: { recordSpend?: boolean; startTime: number },
): Promise<void> {
  const latencyMs = Date.now() - options.startTime;
  const usage = extractAudioTokenUsage(response);
  const estimatedCost = estimateCost(model, usage.promptTokens, usage.completionTokens);

  if (options.recordSpend && estimatedCost !== undefined) {
    await addApiKeySpendUsd(apiKeyId, estimatedCost);
  }

  await logRequest({
    apiKeyId,
    provider,
    model,
    endpoint,
    latencyMs,
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
  endpoint: AudioEndpoint,
  startTime: number,
): Promise<void> {
  const latencyMs = Date.now() - startTime;
  const errorMessage = error instanceof Error ? error.message : "Unknown error";

  await logRequest({
    apiKeyId,
    provider,
    model,
    endpoint,
    latencyMs,
    statusCode: upstreamOpenAICompatibleStatusCode(error),
    errorMessage,
  });
}

function extractAudioTokenUsage(response: AudioProxyResponse): {
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
