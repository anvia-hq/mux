import type { Context } from "hono";
import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import {
  logStreamFinal,
  logStreamStart,
  RequestLoggingUnavailableError,
} from "../../middleware/logger";
import { upstreamOpenAICompatibleErrorResponse } from "../../providers/openai-compatible-error";
import { estimateCost } from "../../providers/registry";
import type { AudioProxyResponse, AudioSpeechRequest } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  addApiKeySpendUsd,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import {
  createAudioUsageAccumulator,
  handleAudioSpeech,
  handleAudioSpeechStream,
  handleAudioTranscription,
  handleAudioTranscriptionStream,
  handleAudioTranslation,
  type AudioEndpoint,
  type AudioProxyStreamResult,
} from "./services";

export const audioRouter = new Hono();

audioRouter.use("*", apiKeyAuth);

audioRouter.post("/transcriptions", async (c) => {
  const parsed = await readAudioFormData(c);
  if (parsed instanceof Response) return parsed;

  if (isAudioMultipartStreamRequested(parsed.formData)) {
    return handleAudioMultipartStreamRoute(c, parsed, handleAudioTranscriptionStream);
  }

  return handleAudioMultipartRoute(c, parsed, handleAudioTranscription);
});

audioRouter.post("/translations", async (c) => {
  const parsed = await readAudioFormData(c);
  if (parsed instanceof Response) return parsed;

  return handleAudioMultipartRoute(c, parsed, handleAudioTranslation);
});

audioRouter.post("/speech", async (c) => {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  let body: AudioSpeechRequest;
  try {
    body = (await c.req.json()) as AudioSpeechRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validationError = validateAudioSpeechRequestShape(body);
  if (validationError) {
    return c.json({ error: validationError }, validationError.includes("stream") ? 422 : 400);
  }

  const accessError = disallowedModelResponse(c, body.model);
  if (accessError) return accessError;

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    if (body.stream_format === "sse" || body.stream_format === "audio") {
      const result = await handleAudioSpeechStream(body, apiKeyId);
      return audioProxyStreamResponse(c, result, "/v1/audio/speech", apiKeyId, isLimitedKey);
    }

    const response = await handleAudioSpeech(body, apiKeyId, { recordSpend: isLimitedKey });
    return audioProxyResponse(response);
  } catch (error) {
    return routeErrorResponse(error);
  }
});

async function handleAudioMultipartRoute(
  c: Context,
  parsed: { formData: FormData; model: string },
  handleAudio: (
    formData: FormData,
    model: string,
    apiKeyId: string,
    options: { recordSpend?: boolean },
  ) => Promise<AudioProxyResponse>,
): Promise<Response> {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  const accessError = disallowedModelResponse(c, parsed.model);
  if (accessError) return accessError;

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const response = await handleAudio(parsed.formData, parsed.model, apiKeyId, {
      recordSpend: isLimitedKey,
    });
    return audioProxyResponse(response);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function handleAudioMultipartStreamRoute(
  c: Context,
  parsed: { formData: FormData; model: string },
  handleAudio: (
    formData: FormData,
    model: string,
    apiKeyId: string,
  ) => Promise<AudioProxyStreamResult>,
): Promise<Response> {
  const apiKeyId = c.get("apiKeyId" as never) as string;
  const spendLimitUsd = c.get("apiKeySpendLimitUsd" as never) as number | null | undefined;
  const isLimitedKey = spendLimitUsd !== null && spendLimitUsd !== undefined;

  const accessError = disallowedModelResponse(c, parsed.model);
  if (accessError) return accessError;

  try {
    if (isLimitedKey) {
      await assertApiKeyCanSpend(apiKeyId, spendLimitUsd);
    }

    const result = await handleAudio(parsed.formData, parsed.model, apiKeyId);
    return audioProxyStreamResponse(c, result, "/v1/audio/transcriptions", apiKeyId, isLimitedKey);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function readAudioFormData(
  c: Context,
): Promise<Response | { formData: FormData; model: string }> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "invalid multipart form-data body" }, 400);
  }

  const validationError = validateAudioMultipartFormData(formData);
  if (validationError) {
    return c.json({ error: validationError }, validationError.includes("stream") ? 422 : 400);
  }

  return { formData, model: String(formData.get("model")) };
}

function validateAudioMultipartFormData(formData: FormData): string | null {
  const model = formData.get("model");
  if (typeof model !== "string" || model.length === 0) {
    return "request must include a model";
  }

  if (!isFileLike(formData.get("file"))) {
    return "request must include a file";
  }

  return null;
}

function validateAudioSpeechRequestShape(value: unknown): string | null {
  if (!value || typeof value !== "object") return "request body must be an object";

  const request = value as Partial<AudioSpeechRequest>;

  if (typeof request.model !== "string" || request.model.length === 0) {
    return "request must include a model";
  }

  if (typeof request.input !== "string" || request.input.length === 0) {
    return "request must include input";
  }

  if (!isSpeechVoice(request.voice)) {
    return "request must include voice";
  }

  if (request.stream_format === "sse") {
    return null;
  }

  if (request.stream_format !== undefined && request.stream_format !== "audio") {
    return "stream_format must be audio or sse";
  }

  return null;
}

function isSpeechVoice(value: unknown): value is AudioSpeechRequest["voice"] {
  if (typeof value === "string") {
    return value.length > 0;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const voice = value as { id?: unknown };
  return typeof voice.id === "string" && voice.id.length > 0;
}

function isFileLike(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      "name" in value,
  );
}

function disallowedModelResponse(c: Context, modelId: string): Response | null {
  try {
    assertApiKeyModelAllowed(modelId, readApiKeyModelAccess(c));
    return null;
  } catch (error) {
    if (error instanceof ApiKeyModelAccessDeniedError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }
}

function audioProxyResponse(response: AudioProxyResponse): Response {
  const headers = new Headers();
  if (response.contentType) {
    headers.set("Content-Type", response.contentType);
  }
  return new Response(response.body, { headers });
}

async function audioProxyStreamResponse(
  c: Context,
  result: AudioProxyStreamResult,
  endpoint: AudioEndpoint,
  apiKeyId: string,
  isLimitedKey: boolean,
): Promise<Response> {
  const logId = await logStreamStart({
    apiKeyId,
    provider: result.provider,
    model: result.model,
    requestedModel: result.requestedModel,
    channelId: result.channelId,
    channelName: result.channelName,
    endpoint,
    latencyMs: 0,
    statusCode: 102,
    errorMessage: "stream pending",
  });

  const contentType = result.contentType ?? "text/event-stream";
  c.header("Content-Type", contentType);
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return honoStream(c, async (streamWriter) => {
    let totalTokens: number | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let streamLogFinalized = false;
    const usageAccumulator = createAudioUsageAccumulator(endpoint, contentType);

    async function finalizeSuccessfulStreamLog() {
      if (streamLogFinalized) return;
      streamLogFinalized = true;

      const estimatedCost = estimateCost(result.model, promptTokens, completionTokens);

      if (isLimitedKey && estimatedCost !== undefined) {
        try {
          await addApiKeySpendUsd(apiKeyId, estimatedCost);
        } catch (spendError) {
          console.error("Failed to record streamed audio spend:", spendError);
        }
      }

      await logStreamFinal({
        logId,
        apiKeyId,
        provider: result.provider,
        model: result.model,
        requestedModel: result.requestedModel,
        channelId: result.channelId,
        channelName: result.channelName,
        endpoint,
        latencyMs: result.latencyMs,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost,
        statusCode: 200,
      });
    }

    function updateUsage(usage: {
      totalTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
    }) {
      if (usage.totalTokens !== undefined) totalTokens = usage.totalTokens;
      if (usage.promptTokens !== undefined) promptTokens = usage.promptTokens;
      if (usage.completionTokens !== undefined) completionTokens = usage.completionTokens;
    }

    try {
      for await (const chunk of result.stream) {
        updateUsage(usageAccumulator.push(chunk));

        await streamWriter.write(chunk);
      }

      updateUsage(usageAccumulator.final());

      try {
        await finalizeSuccessfulStreamLog();
      } catch (logError) {
        console.error("Failed to finalize request log:", logError);
      }
    } catch (streamError) {
      const errorMessage = streamError instanceof Error ? streamError.message : "Unknown error";

      try {
        if (!streamLogFinalized) {
          await logStreamFinal({
            logId,
            apiKeyId,
            provider: result.provider,
            model: result.model,
            requestedModel: result.requestedModel,
            channelId: result.channelId,
            channelName: result.channelName,
            endpoint,
            latencyMs: result.latencyMs,
            statusCode: 500,
            errorMessage,
          });
          streamLogFinalized = true;
        }
      } catch (logError) {
        console.error("Failed to finalize failed request log:", logError);
      }

      throw streamError;
    }
  });
}

function isAudioMultipartStreamRequested(formData: FormData): boolean {
  return formData.getAll("stream").some((value) => typeof value === "string" && value === "true");
}

function routeErrorResponse(error: unknown): Response {
  const upstream = upstreamOpenAICompatibleErrorResponse(error);
  if (upstream) return upstream;

  const errorMessage = error instanceof Error ? error.message : "Internal server error";

  if (errorMessage.startsWith("No provider found")) {
    return Response.json({ error: errorMessage }, { status: 404 });
  }

  if (error instanceof ApiKeySpendLimitExceededError) {
    return Response.json({ error: errorMessage }, { status: 429 });
  }

  if (error instanceof ApiKeyModelAccessDeniedError) {
    return Response.json({ error: errorMessage }, { status: 403 });
  }

  if (
    error instanceof RequestLoggingUnavailableError ||
    error instanceof ApiKeySpendLedgerUnavailableError
  ) {
    return Response.json({ error: errorMessage }, { status: 503 });
  }

  return Response.json({ error: errorMessage }, { status: 500 });
}
