const ALPHAVANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const REQUEST_TIMEOUT_MS = 12_000;

export interface PluginContext {
  env: Readonly<Record<string, string>>;
}

type QueryParamValue = string | boolean | undefined;
type QueryParams = Record<string, QueryParamValue>;
type FetchFn = typeof fetch;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractApiError = (payload: Record<string, unknown>): string | undefined => {
  if (typeof payload["Error Message"] === "string" && payload["Error Message"].length > 0) {
    return payload["Error Message"];
  }

  const keys = Object.keys(payload);

  if (keys.length === 1 && typeof payload.Information === "string") {
    return payload.Information;
  }

  if (keys.length === 1 && typeof payload.Note === "string") {
    return payload.Note;
  }

  return undefined;
};

export const createAlphaVantageClient = (fetchFn: FetchFn = fetch) => {
  const callApi = async (
    fn: string,
    params: QueryParams,
    ctx: PluginContext,
  ): Promise<Record<string, unknown> | string> => {
    const apiKey = ctx.env.ALPHAVANTAGE_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("Missing ALPHAVANTAGE_API_KEY secret.");
    }

    const url = new URL(ALPHAVANTAGE_BASE_URL);
    url.searchParams.set("function", fn);
    url.searchParams.set("apikey", apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        continue;
      }

      if (typeof value === "boolean") {
        url.searchParams.set(key, value ? "true" : "false");
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
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Alpha Vantage request failed with HTTP ${response.status}.`);
    }

    if (params.datatype === "csv") {
      return response.text();
    }

    const payload: unknown = await response.json();

    if (!isPlainObject(payload)) {
      throw new Error("Unexpected non-object JSON response from Alpha Vantage.");
    }

    const apiError = extractApiError(payload);

    if (apiError) {
      throw new Error(`Alpha Vantage API error: ${apiError}`);
    }

    return payload;
  };

  return {
    timeSeriesIntraday: (
      args: {
        symbol: string;
        interval: "1min" | "5min" | "15min" | "30min" | "60min";
        adjusted?: boolean;
        extended_hours?: boolean;
        month?: string;
        outputsize?: "compact" | "full";
        datatype?: "json" | "csv";
        entitlement?: "realtime" | "delayed";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_INTRADAY", args, ctx),

    timeSeriesDaily: (
      args: {
        symbol: string;
        outputsize?: "compact" | "full";
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_DAILY", args, ctx),

    timeSeriesDailyAdjusted: (
      args: {
        symbol: string;
        outputsize?: "compact" | "full";
        datatype?: "json" | "csv";
        entitlement?: "realtime" | "delayed";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_DAILY_ADJUSTED", args, ctx),

    timeSeriesWeekly: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_WEEKLY", args, ctx),

    timeSeriesWeeklyAdjusted: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_WEEKLY_ADJUSTED", args, ctx),

    timeSeriesMonthly: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_MONTHLY", args, ctx),

    timeSeriesMonthlyAdjusted: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("TIME_SERIES_MONTHLY_ADJUSTED", args, ctx),

    globalQuote: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
        entitlement?: "realtime" | "delayed";
      },
      ctx: PluginContext,
    ) => callApi("GLOBAL_QUOTE", args, ctx),

    realtimeBulkQuotes: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("REALTIME_BULK_QUOTES", args, ctx),

    realtimeBulkBidAskPrices: (
      args: {
        symbol: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("REALTIME_BULK_BID_ASK_PRICES", args, ctx),

    symbolSearch: (
      args: {
        keywords: string;
        datatype?: "json" | "csv";
      },
      ctx: PluginContext,
    ) => callApi("SYMBOL_SEARCH", args, ctx),

    marketStatus: (_args: Record<string, never>, ctx: PluginContext) =>
      callApi("MARKET_STATUS", {}, ctx),
  };
};

const defaultClient = createAlphaVantageClient();

export const timeSeriesIntraday = defaultClient.timeSeriesIntraday;
export const timeSeriesDaily = defaultClient.timeSeriesDaily;
export const timeSeriesDailyAdjusted = defaultClient.timeSeriesDailyAdjusted;
export const timeSeriesWeekly = defaultClient.timeSeriesWeekly;
export const timeSeriesWeeklyAdjusted = defaultClient.timeSeriesWeeklyAdjusted;
export const timeSeriesMonthly = defaultClient.timeSeriesMonthly;
export const timeSeriesMonthlyAdjusted = defaultClient.timeSeriesMonthlyAdjusted;
export const globalQuote = defaultClient.globalQuote;
export const realtimeBulkQuotes = defaultClient.realtimeBulkQuotes;
export const realtimeBulkBidAskPrices = defaultClient.realtimeBulkBidAskPrices;
export const symbolSearch = defaultClient.symbolSearch;
export const marketStatus = defaultClient.marketStatus;
