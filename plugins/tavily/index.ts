const TAVILY_BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 55_000;

export interface PluginContext {
  env: Readonly<Record<string, string>>;
}

type FetchFn = typeof fetch;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractErrorMessage = (payload: unknown, status: number): string => {
  if (isPlainObject(payload)) {
    if (typeof payload.detail === "string" && payload.detail.length > 0) {
      return payload.detail;
    }

    if (
      isPlainObject(payload.detail) &&
      typeof payload.detail.error === "string" &&
      payload.detail.error.length > 0
    ) {
      return payload.detail.error;
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  }

  return `Tavily request failed with HTTP ${status}.`;
};

export const createTavilyClient = (fetchFn: FetchFn = fetch) => {
  const getApiKey = (ctx: PluginContext): string => {
    const apiKey = ctx.env.TAVILY_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("Missing TAVILY_API_KEY secret.");
    }

    return apiKey;
  };

  const requestJson = async (
    method: "GET" | "POST",
    path: string,
    ctx: PluginContext,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const apiKey = getApiKey(ctx);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchFn(`${TAVILY_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const rawText = await response.text();
    let payload: unknown;

    if (rawText.length > 0) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        if (!response.ok) {
          throw new Error(`Tavily request failed with HTTP ${response.status}.`);
        }

        throw new Error("Unexpected non-JSON response from Tavily.");
      }
    }

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, response.status));
    }

    if (!isPlainObject(payload)) {
      throw new Error("Unexpected non-object JSON response from Tavily.");
    }

    return payload;
  };

  return {
    tavilySearch: (args: Record<string, unknown>, ctx: PluginContext) =>
      requestJson("POST", "/search", ctx, args),

    tavilyExtract: (args: Record<string, unknown>, ctx: PluginContext) =>
      requestJson("POST", "/extract", ctx, args),

    tavilyCrawl: (args: Record<string, unknown>, ctx: PluginContext) =>
      requestJson("POST", "/crawl", ctx, args),

    tavilyMap: (args: Record<string, unknown>, ctx: PluginContext) =>
      requestJson("POST", "/map", ctx, args),

    tavilyResearch: (args: Record<string, unknown>, ctx: PluginContext) =>
      requestJson("POST", "/research", ctx, { ...args, stream: false }),

    tavilyResearchGet: (
      args: { request_id: string; include_usage?: boolean },
      ctx: PluginContext,
    ) => {
      const encodedId = encodeURIComponent(args.request_id);
      const query = args.include_usage === true ? "?include_usage=true" : "";

      return requestJson("GET", `/research/${encodedId}${query}`, ctx);
    },
  };
};

const defaultClient = createTavilyClient();

export const tavilySearch = defaultClient.tavilySearch;
export const tavilyExtract = defaultClient.tavilyExtract;
export const tavilyCrawl = defaultClient.tavilyCrawl;
export const tavilyMap = defaultClient.tavilyMap;
export const tavilyResearch = defaultClient.tavilyResearch;
export const tavilyResearchGet = defaultClient.tavilyResearchGet;
