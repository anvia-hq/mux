import type {
  AudioMultipartRequest,
  AudioProxyResponse,
  AudioProxyStreamResponse,
  AudioSpeechRequest,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  Model,
  ModerationRequest,
  ModerationResponse,
  ProviderAdapter,
  ProviderRequestOptions,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";
import {
  cloneFormDataWithModel,
  toAudioProxyResponse,
  toAudioProxyStreamResponse,
} from "./openai-compatible-audio";
import { throwOpenAICompatibleError } from "./openai-compatible-error";
import { mergeProviderRequestHeaders } from "./types";
import {
  streamImageGenerationResponseBody,
  streamTextResponseBody,
} from "./openai-compatible-stream";

const REQUEST_TIMEOUT_MS = 60_000;

export class CustomOpenAICompatibleAdapter implements ProviderAdapter {
  readonly capabilities: ProviderAdapter["capabilities"];
  private readonly apiKey: string;
  private readonly chatCompletionsUrl: string;
  private readonly embeddingsUrl: string;
  private readonly moderationsUrl: string;
  private readonly imageGenerationsUrl: string;
  private readonly completionsUrl: string;
  private readonly audioTranscriptionsUrl: string;
  private readonly audioTranslationsUrl: string;
  private readonly audioSpeechUrl: string;
  private readonly responsesUrl?: string;
  private readonly models: Model[];

  constructor(input: {
    name: string;
    apiKey: string;
    apiBase: string;
    models: Model[];
    responsesMode?: "disabled" | "native" | "via_chat";
    responsesEndpoint?: string;
  }) {
    this.name = input.name;
    this.apiKey = input.apiKey;
    this.capabilities = {
      ...openAICompatibleCapabilities,
      responsesTransport:
        input.responsesMode === "native"
          ? "native"
          : input.responsesMode === "via_chat"
            ? "chat"
            : undefined,
    };
    this.chatCompletionsUrl = this.toChatCompletionsUrl(input.apiBase);
    this.embeddingsUrl = this.toEndpointUrl(input.apiBase, "embeddings");
    this.moderationsUrl = this.toEndpointUrl(input.apiBase, "moderations");
    this.imageGenerationsUrl = this.toEndpointUrl(input.apiBase, "images/generations");
    this.completionsUrl = this.toEndpointUrl(input.apiBase, "completions");
    this.audioTranscriptionsUrl = this.toEndpointUrl(input.apiBase, "audio/transcriptions");
    this.audioTranslationsUrl = this.toEndpointUrl(input.apiBase, "audio/translations");
    this.audioSpeechUrl = this.toEndpointUrl(input.apiBase, "audio/speech");
    this.responsesUrl =
      input.responsesMode === "native"
        ? input.responsesEndpoint || this.toEndpointUrl(input.apiBase, "responses")
        : undefined;
    this.models = input.models;
  }

  readonly name: string;

  async chatCompletion(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? buildOpenAICompatibleRequestBody(request, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  async *chatCompletionStream(
    request: ChatCompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(this.chatCompletionsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? buildOpenAICompatibleRequestBody(request, true),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          if (!line.startsWith("data: ")) continue;

          const data = line.slice(6);
          if (data === "[DONE]") return;

          try {
            yield JSON.parse(data) as ChatCompletionChunk;
          } catch (error) {
            throw new Error(
              `Failed to parse ${this.name} SSE chunk: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The response body may already be closed or aborted.
      }
      reader.releaseLock();
    }
  }

  async createResponse(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.requireResponsesUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async *createResponseStream(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(this.requireResponsesUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    yield* streamTextResponseBody(response);
  }

  async getResponse(
    id: string,
    query?: Record<string, string | string[]>,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const url = this.responseOperationUrl(id);
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
    }
    const response = await fetch(url, {
      headers: this.buildHeaders(options),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async deleteResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.responseOperationUrl(id).toString(), {
      method: "DELETE",
      headers: this.buildHeaders(options),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async cancelResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.responseOperationUrl(id, "cancel").toString(), {
      method: "POST",
      headers: this.buildHeaders(options),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async compactResponse(
    request: ResponseCompactRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.responseOperationUrl("compact").toString(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async countResponseInputTokens(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.responseOperationUrl("input_tokens").toString(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async listResponseInputItems(
    id: string,
    query?: Record<string, string | string[]>,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const url = this.responseOperationUrl(id, "input_items");
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
    }
    const response = await fetch(url, {
      headers: this.buildHeaders(options),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);
    if (!response.ok) await throwOpenAICompatibleError(this.name, response);
    return (await response.json()) as ResponseObject;
  }

  async createEmbedding(
    request: EmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<EmbeddingResponse> {
    const response = await fetch(this.embeddingsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return (await response.json()) as EmbeddingResponse;
  }

  async createModeration(
    request: ModerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ModerationResponse> {
    const response = await fetch(this.moderationsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return (await response.json()) as ModerationResponse;
  }

  async createImageGeneration(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): Promise<ImageGenerationResponse> {
    const response = await fetch(this.imageGenerationsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return (await response.json()) as ImageGenerationResponse;
  }

  async *createImageGenerationStream(
    request: ImageGenerationRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(this.imageGenerationsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    yield* streamImageGenerationResponseBody(response);
  }

  async createCompletion(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): Promise<CompletionResponse> {
    const response = await fetch(this.completionsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return (await response.json()) as CompletionResponse;
  }

  async *createCompletionStream(
    request: CompletionRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    yield* this.createRawStream(this.completionsUrl, { ...request, stream: true }, options);
  }

  async createAudioTranscription(request: AudioMultipartRequest): Promise<AudioProxyResponse> {
    return this.createAudioMultipart(this.audioTranscriptionsUrl, request);
  }

  async createAudioTranscriptionStream(
    request: AudioMultipartRequest,
  ): Promise<AudioProxyStreamResponse> {
    return this.createAudioMultipartStream(this.audioTranscriptionsUrl, request);
  }

  async createAudioTranslation(request: AudioMultipartRequest): Promise<AudioProxyResponse> {
    return this.createAudioMultipart(this.audioTranslationsUrl, request);
  }

  async createAudioSpeech(request: AudioSpeechRequest): Promise<AudioProxyResponse> {
    const response = await fetch(this.audioSpeechUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return toAudioProxyResponse(response);
  }

  async createAudioSpeechStream(request: AudioSpeechRequest): Promise<AudioProxyStreamResponse> {
    const response = await fetch(this.audioSpeechUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return toAudioProxyStreamResponse(response);
  }

  listModels(): Model[] {
    return this.models;
  }

  private buildHeaders(options?: ProviderRequestOptions): Record<string, string> {
    return mergeProviderRequestHeaders(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      options,
    );
  }

  private async *createRawStream(
    url: string,
    request: Record<string, unknown>,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    yield* streamTextResponseBody(response);
  }

  private async createAudioMultipart(
    url: string,
    request: AudioMultipartRequest,
  ): Promise<AudioProxyResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: cloneFormDataWithModel(request.formData, request.model),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return toAudioProxyResponse(response);
  }

  private async createAudioMultipartStream(
    url: string,
    request: AudioMultipartRequest,
  ): Promise<AudioProxyStreamResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: cloneFormDataWithModel(request.formData, request.model),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await throwOpenAICompatibleError(this.name, response);
    }

    return toAudioProxyStreamResponse(response);
  }

  private toChatCompletionsUrl(apiBase: string): string {
    return this.toEndpointUrl(apiBase, "chat/completions");
  }

  private toEndpointUrl(apiBase: string, endpoint: string): string {
    const normalized = apiBase.replace(/\/$/, "");
    if (normalized.endsWith("/chat/completions")) {
      if (endpoint === "chat/completions") {
        return normalized;
      }
      return normalized.replace(/\/chat\/completions$/, `/${endpoint}`);
    }
    if (normalized.endsWith(`/${endpoint}`)) {
      return normalized;
    }
    return `${normalized}/${endpoint}`;
  }

  private requireResponsesUrl(): string {
    if (!this.responsesUrl) throw new Error(`${this.name} Responses transport is disabled`);
    return this.responsesUrl;
  }

  private responseOperationUrl(...segments: string[]): URL {
    const url = new URL(this.requireResponsesUrl());
    const basePath = url.pathname.replace(/\/$/, "");
    url.pathname = `${basePath}/${segments.map(encodeURIComponent).join("/")}`;
    return url;
  }
}
