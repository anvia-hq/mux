import type { Context } from "hono";
import { Hono } from "hono";
import { apiKeyAuth, readApiKeyModelAccess } from "../../middleware/api-key";
import { RequestLoggingUnavailableError } from "../../middleware/logger";
import { upstreamOpenAICompatibleErrorResponse } from "../../providers/openai-compatible-error";
import type { AudioProxyResponse, AudioSpeechRequest } from "../../providers/types";
import {
  ApiKeyModelAccessDeniedError,
  ApiKeySpendLedgerUnavailableError,
  ApiKeySpendLimitExceededError,
  assertApiKeyCanSpend,
  assertApiKeyModelAllowed,
} from "../keys/services";
import { handleAudioSpeech, handleAudioTranscription, handleAudioTranslation } from "./services";

export const audioRouter = new Hono();

audioRouter.use("*", apiKeyAuth);

audioRouter.post("/transcriptions", async (c) => {
  const parsed = await readAudioFormData(c, { rejectStream: true });
  if (parsed instanceof Response) return parsed;

  return handleAudioMultipartRoute(c, parsed, handleAudioTranscription);
});

audioRouter.post("/translations", async (c) => {
  const parsed = await readAudioFormData(c, { rejectStream: false });
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

async function readAudioFormData(
  c: Context,
  options: { rejectStream: boolean },
): Promise<Response | { formData: FormData; model: string }> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "invalid multipart form-data body" }, 400);
  }

  const validationError = validateAudioMultipartFormData(formData, options);
  if (validationError) {
    return c.json({ error: validationError }, validationError.includes("stream") ? 422 : 400);
  }

  return { formData, model: String(formData.get("model")) };
}

function validateAudioMultipartFormData(
  formData: FormData,
  options: { rejectStream: boolean },
): string | null {
  const model = formData.get("model");
  if (typeof model !== "string" || model.length === 0) {
    return "request must include a model";
  }

  if (!isFileLike(formData.get("file"))) {
    return "request must include a file";
  }

  if (
    options.rejectStream &&
    formData.getAll("stream").some((value) => typeof value === "string" && value === "true")
  ) {
    return "streaming audio transcriptions are not supported yet";
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
    return "streaming audio speech is not supported yet";
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
