import type {
  ProviderCapabilities,
  ProviderRequestOptions,
  ResponseCompactRequest,
  ResponseCreateRequest,
  ResponseObject,
} from "./types";
import { mergeProviderRequestHeaders } from "./types";
import { openAICompatibleCapabilities } from "./chat-compat";
import { AZURE_OPENAI_RESPONSES_API_VERSION } from "./models-dev-provider-adapter";
import { streamTextResponseBody } from "./openai-compatible-stream";
import { throwResponsesApiError } from "./responses-api-error";

export type AzureResponsesQuery = Record<string, string | string[]>;

const REQUEST_TIMEOUT_MS = 60_000;

export const azureCapabilities: ProviderCapabilities = {
  ...openAICompatibleCapabilities,
  responsesTransport: "native",
  embeddingsApi: false,
  moderationsApi: false,
  imageGenerationsApi: false,
  completionsApi: false,
  audioTranscriptionsApi: false,
  audioTranslationsApi: false,
  audioSpeechApi: false,
};

export class AzureResponsesEndpointNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} Responses endpoint is not configured; set AZURE_OPENAI_RESPONSES_ENDPOINT`);
    this.name = "AzureResponsesEndpointNotConfiguredError";
  }
}

/**
 * Implements the OpenAI Responses API surface against an Azure
 * deployment. Used by both `AzureAdapter` and
 * `AzureCognitiveServicesAdapter` via composition. The base URL is
 * supplied by the caller; the api-version query parameter is the
 * one Azure requires for Responses (overridable per call site).
 */
export class AzureResponsesClient {
  private apiKey: string;
  private endpoint: string | undefined;
  private apiVersion: string;
  private providerName: string;

  constructor(input: {
    providerName: string;
    apiKey: string;
    endpoint?: string;
    apiVersion?: string;
  }) {
    this.providerName = input.providerName;
    this.apiKey = input.apiKey;
    this.endpoint = input.endpoint;
    this.apiVersion = input.apiVersion ?? AZURE_OPENAI_RESPONSES_API_VERSION;
  }

  private getResponsesBaseUrl(): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    return `${normalized}/openai/v1/responses?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  private getResponsesItemUrl(id: string, query?: AzureResponsesQuery): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    const params = new URLSearchParams({ "api-version": this.apiVersion });
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
    }
    return `${normalized}/openai/v1/responses/${encodeURIComponent(id)}?${params.toString()}`;
  }

  private getResponsesCancelUrl(id: string): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    return `${normalized}/openai/v1/responses/${encodeURIComponent(id)}/cancel?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  private getResponsesCompactUrl(): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    return `${normalized}/openai/v1/responses/compact?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  private getResponsesInputTokensUrl(): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    return `${normalized}/openai/v1/responses/input_tokens?api-version=${encodeURIComponent(this.apiVersion)}`;
  }

  private buildResponsesQueryString(query?: AzureResponsesQuery): string {
    const params = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const v of value) params.append(key, v);
        } else if (value !== undefined) {
          params.append(key, value);
        }
      }
    }
    return params.toString();
  }

  private getResponsesInputItemsUrl(id: string, query?: AzureResponsesQuery): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    const qs = this.buildResponsesQueryString(query);
    const base = `${normalized}/openai/v1/responses/${encodeURIComponent(id)}/input_items`;
    const tail = `?api-version=${encodeURIComponent(this.apiVersion)}`;
    return qs ? `${base}${tail}&${qs}` : `${base}${tail}`;
  }

  private buildHeaders(
    options?: ProviderRequestOptions,
    includeContentType = true,
  ): Record<string, string> {
    return mergeProviderRequestHeaders(
      {
        ...(includeContentType ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${this.apiKey}`,
      },
      options,
    );
  }

  async createResponse(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesBaseUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async *createResponseStream(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): AsyncIterable<string> {
    const response = await fetch(this.getResponsesBaseUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify({ ...request, stream: true }),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    yield* streamTextResponseBody(response);
  }

  async getResponse(
    id: string,
    query?: AzureResponsesQuery,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesItemUrl(id, query), {
      method: "GET",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async deleteResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesItemUrl(id), {
      method: "DELETE",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async cancelResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesCancelUrl(id), {
      method: "POST",
      headers: this.buildHeaders(options),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async compactResponse(
    request: ResponseCompactRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesCompactUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async countResponseInputTokens(
    request: ResponseCreateRequest,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesInputTokensUrl(), {
      method: "POST",
      headers: this.buildHeaders(options),
      body: options?.rawBody ?? JSON.stringify(request),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }

  async listResponseInputItems(
    id: string,
    query?: AzureResponsesQuery,
    options?: ProviderRequestOptions,
  ): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesInputItemsUrl(id, query), {
      method: "GET",
      headers: this.buildHeaders(options, false),
      signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    options?.onResponse?.(response);

    if (!response.ok) {
      await throwResponsesApiError(this.providerName, response);
    }

    return (await response.json()) as ResponseObject;
  }
}
