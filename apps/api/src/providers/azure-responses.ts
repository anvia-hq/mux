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

export type AzureResponsesQuery = Record<string, string | string[]>;

const REQUEST_TIMEOUT_MS = 60_000;

export const azureCapabilities: ProviderCapabilities = {
  ...openAICompatibleCapabilities,
  responsesApi: true,
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

  private getResponsesItemUrl(id: string): string {
    if (!this.endpoint) {
      throw new AzureResponsesEndpointNotConfiguredError(this.providerName);
    }
    const normalized = this.endpoint.replace(/\/$/, "");
    return `${normalized}/openai/v1/responses/${encodeURIComponent(id)}?api-version=${encodeURIComponent(this.apiVersion)}`;
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }

    const tail = decoder.decode();
    if (tail) yield tail;
  }

  async getResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesItemUrl(id), {
      method: "GET",
      headers: this.buildHeaders(options, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ResponseObject;
  }

  async deleteResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesItemUrl(id), {
      method: "DELETE",
      headers: this.buildHeaders(options, false),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ResponseObject;
  }

  async cancelResponse(id: string, options?: ProviderRequestOptions): Promise<ResponseObject> {
    const response = await fetch(this.getResponsesCancelUrl(id), {
      method: "POST",
      headers: this.buildHeaders(options),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.providerName} Responses API error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ResponseObject;
  }
}
