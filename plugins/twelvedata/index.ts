const TWELVEDATA_BASE_URL = "https://api.twelvedata.com";
const REQUEST_TIMEOUT_MS = 12_000;

export interface PluginContext {
  env: Readonly<Record<string, string>>;
}

type QueryParamValue = string | number | boolean | undefined;
type QueryParams = Record<string, QueryParamValue>;
type FetchFn = typeof fetch;

interface InstrumentIdentifierArgs {
  symbol?: string;
  figi?: string;
  isin?: string;
  cusip?: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireInstrumentIdentifier = (args: InstrumentIdentifierArgs): void => {
  if (!args.symbol && !args.figi && !args.isin && !args.cusip) {
    throw new Error("At least one of symbol, figi, isin, or cusip is required.");
  }
};

const extractErrorMessage = (payload: unknown, status: number): string => {
  if (isPlainObject(payload) && typeof payload.message === "string" && payload.message.length > 0) {
    return payload.message;
  }

  return `Twelve Data request failed with HTTP ${status}.`;
};

export const createTwelveDataClient = (fetchFn: FetchFn = fetch) => {
  const getApiKey = (ctx: PluginContext): string => {
    const apiKey = ctx.env.TWELVEDATA_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("Missing TWELVEDATA_API_KEY secret.");
    }

    return apiKey;
  };

  const requestGet = async (
    path: string,
    params: QueryParams,
    ctx: PluginContext,
  ): Promise<Record<string, unknown> | string> => {
    const apiKey = getApiKey(ctx);
    const url = new URL(`${TWELVEDATA_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }

      if (typeof value === "boolean") {
        url.searchParams.set(key, value ? "true" : "false");
        continue;
      }

      if (typeof value === "number") {
        url.searchParams.set(key, String(value));
        continue;
      }

      if (value.length > 0) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json, text/csv;q=0.9",
        Authorization: `apikey ${apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorPayload: unknown;

      if (errorText.length > 0) {
        try {
          errorPayload = JSON.parse(errorText);
        } catch {
          throw new Error(`Twelve Data request failed with HTTP ${response.status}.`);
        }
      }

      throw new Error(extractErrorMessage(errorPayload, response.status));
    }

    if (params.format === "CSV") {
      return response.text();
    }

    const payload: unknown = await response.json();

    if (!isPlainObject(payload)) {
      throw new Error("Unexpected non-object JSON response from Twelve Data.");
    }

    if (payload.status === "error") {
      throw new Error(extractErrorMessage(payload, response.status));
    }

    return payload;
  };

  return {
    timeSeries: async (args: InstrumentIdentifierArgs & QueryParams, ctx: PluginContext) => {
      requireInstrumentIdentifier(args);
      return requestGet("/time_series", args, ctx);
    },

    timeSeriesCross: (
      args: { base: string; quote: string; interval: string } & QueryParams,
      ctx: PluginContext,
    ) => requestGet("/time_series/cross", args, ctx),

    quote: async (args: InstrumentIdentifierArgs & QueryParams, ctx: PluginContext) => {
      requireInstrumentIdentifier(args);
      return requestGet("/quote", args, ctx);
    },

    latestPrice: async (args: InstrumentIdentifierArgs & QueryParams, ctx: PluginContext) => {
      requireInstrumentIdentifier(args);
      return requestGet("/price", args, ctx);
    },

    endOfDayPrice: async (args: InstrumentIdentifierArgs & QueryParams, ctx: PluginContext) => {
      requireInstrumentIdentifier(args);
      return requestGet("/eod", args, ctx);
    },

    marketMovers: (args: { market: string } & QueryParams, ctx: PluginContext) => {
      const { market, ...queryParams } = args;
      const encodedMarket = encodeURIComponent(market);

      return requestGet(`/market_movers/${encodedMarket}`, queryParams, ctx);
    },
  };
};

const defaultClient = createTwelveDataClient();

export const timeSeries = defaultClient.timeSeries;
export const timeSeriesCross = defaultClient.timeSeriesCross;
export const quote = defaultClient.quote;
export const latestPrice = defaultClient.latestPrice;
export const endOfDayPrice = defaultClient.endOfDayPrice;
export const marketMovers = defaultClient.marketMovers;
