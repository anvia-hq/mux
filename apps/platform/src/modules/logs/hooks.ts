import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export type RequestLog = {
  id: string;
  provider: string;
  model: string;
  requestedModel: string | null;
  endpoint: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  pricingInputTokens: number | null;
  appliedInputPricePer1M: number | null;
  appliedOutputPricePer1M: number | null;
  appliedPricingTierThreshold: number | null;
  statusCode: number;
  errorMessage: string | null;
  createdAt: string;
  apiKey: { name: string };
};

export type LogsStats = {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  byProvider: Array<{
    provider: string;
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }>;
  byModel: Array<{
    model: string;
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }>;
  daily: Array<{
    date: string;
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
  }>;
};

const queryKey = ["logs"] as const;

export type LogFilters = {
  userId?: string;
  apiKeyId?: string;
  provider?: string;
  model?: string;
  limit: number;
  offset: number;
};

export function useLogsQuery(filters: LogFilters) {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.apiKeyId) params.set("apiKeyId", filters.apiKeyId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.model) params.set("model", filters.model);
  params.set("limit", String(filters.limit));
  params.set("offset", String(filters.offset));
  return useQuery({
    queryKey: [...queryKey, "list", filters] as const,
    queryFn: () => apiFetch<{ logs: RequestLog[]; total: number }>(`/logs?${params}`),
  });
}

export type StatsRangeDays = 7 | 30 | 90;

export type StatsFilters = {
  days?: StatsRangeDays;
  userId?: string;
  apiKeyId?: string;
  provider?: string;
  model?: string;
};

export function useLogsStatsQuery(filters: StatsFilters = {}) {
  const params = new URLSearchParams();
  if (filters.days) params.set("days", String(filters.days));
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.apiKeyId) params.set("apiKeyId", filters.apiKeyId);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.model) params.set("model", filters.model);
  const query = params.toString();

  return useQuery({
    queryKey: [...queryKey, "stats", filters] as const,
    queryFn: () => apiFetch<LogsStats>(query ? `/logs/stats?${query}` : "/logs/stats"),
    refetchInterval: 15_000,
  });
}
