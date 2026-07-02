import type {
  AudioMultipartRequest,
  AudioProxyResponse,
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
} from "./types";
import { buildOpenAICompatibleRequestBody, openAICompatibleCapabilities } from "./chat-compat";
import { cloneFormDataWithModel, toAudioProxyResponse } from "./openai-compatible-audio";
import { throwOpenAICompatibleError } from "./openai-compatible-error";
import { mergeProviderRequestHeaders } from "./types";
import {
  streamImageGenerationResponseBody,
  streamTextResponseBody,
} from "./openai-compatible-stream";

const REQUEST_TIMEOUT_MS = 60_000;

export class CustomOpenAICompatibleAdapter implements ProviderAdapter {
  readonly capabilities = { ...openAICompatibleCapabilities, responsesApi: false };
  private readonly apiKey: string;
  private readonly chatCompletionsUrl: string;
  private readonly embeddingsUrl: string;
  private readonly moderationsUrl: string;
  private readonly imageGenerationsUrl: string;
  private readonly completionsUrl: string;
  private readonly audioTranscriptionsUrl: string;
  private readonly audioTranslationsUrl: string;
  private readonly audioSpeechUrl: string;
  private readonly models: Model[];

  constructor(input: { name: string; apiKey: string; apiBase: string; models: Model[] }) {
    this.name = input.name;
    this.apiKey = input.apiKey;
    this.chatCompletionsUrl = this.toChatCompletionsUrl(input.apiBase);
    this.embeddingsUrl = this.toEndpointUrl(input.apiBase, "embeddings");
    this.moderationsUrl = this.toEndpointUrl(input.apiBase, "moderations");
    this.imageGenerationsUrl = this.toEndpointUrl(input.apiBase, "images/generations");
    this.completionsUrl = this.toEndpointUrl(input.apiBase, "completions");
    this.audioTranscriptionsUrl = this.toEndpointUrl(input.apiBase, "audio/transcriptions");
    this.audioTranslationsUrl = this.toEndpointUrl(input.apiBase, "audio/translations");
    this.audioSpeechUrl = this.toEndpointUrl(input.apiBase, "audio/speech");
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

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
  }

  async createEmbedding(
    request: EmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<EmbeddingResponse> {
    const response = await fetch(this.embeddingsUrl, {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error: ${response.status} - ${error}`);
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
}
