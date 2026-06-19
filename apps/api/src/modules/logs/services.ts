import type { Prisma } from "@prisma/client";
import { prisma } from "../../utils/prisma";

/**
 * Filter shape accepted by {@link getLogs}. All fields are optional; an empty
 * object returns the most recent logs with the default pagination.
 */
export type LogFilters = {
  apiKeyId?: string;
  provider?: string;
  model?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
};

/**
 * Aggregation bucket returned for {@link getStats}. `tokens` and `cost` are
 * summed across the matching logs and are zero (not null) when no logs match.
 */
export type GroupedStat = {
  requests: number;
  tokens: number;
  cost: number;
};

/**
 * Shape returned by {@link getStats}. Aggregates are computed across the full
 * filtered set as well as broken down by provider and model.
 */
export type Stats = {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Array<{ provider: string } & GroupedStat>;
  byModel: Array<{ model: string } & GroupedStat>;
};

/**
 * Translate the public {@link LogFilters} shape into a Prisma `where` clause.
 * Centralized here so the query builders stay in sync with the filter type.
 */
function buildLogWhere(filters: LogFilters): Prisma.RequestLogWhereInput {
  const where: Prisma.RequestLogWhereInput = {};

  if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
  if (filters.provider) where.provider = filters.provider;
  if (filters.model) where.model = filters.model;
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  return where;
}

/**
 * Page through request logs with optional filtering.
 *
 * Results are ordered newest-first and include the API key name so the admin
 * UI can render a human-friendly identifier without an extra lookup. The
 * `total` count reflects the unpaginated result set so callers can render
 * pagination controls.
 */
export async function getLogs(filters: LogFilters) {
  const where = buildLogWhere(filters);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const [logs, total] = await Promise.all([
    prisma.requestLog.findMany({
      where,
      select: {
        id: true,
        apiKeyId: true,
        provider: true,
        model: true,
        endpoint: true,
        latencyMs: true,
        providerLatencyMs: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCost: true,
        statusCode: true,
        errorMessage: true,
        createdAt: true,
        apiKey: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.requestLog.count({ where }),
  ]);

  return { logs, total, limit, offset };
}

/**
 * Filter shape accepted by {@link getStats}. Date filters apply to all
 * aggregates; `groupBy` is accepted for forward compatibility but the current
 * implementation always returns breakdowns by both provider and model.
 */
export type StatsFilters = {
  startDate?: Date;
  endDate?: Date;
  groupBy?: "provider" | "model" | "apiKey";
};

/**
 * Compute aggregate request statistics over the filtered log set.
 *
 * Runs the totals and per-group aggregations in parallel. Nullable summed
 * fields are normalized to `0` so consumers do not need to defend against
 * null in the response shape.
 */
export async function getStats(filters: StatsFilters): Promise<Stats> {
  const where: Prisma.RequestLogWhereInput = {};

  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [totalRequests, totalTokensAgg, totalCostAgg, byProvider, byModel] = await Promise.all([
    prisma.requestLog.count({ where }),
    prisma.requestLog.aggregate({
      where,
      _sum: { totalTokens: true },
    }),
    prisma.requestLog.aggregate({
      where,
      _sum: { estimatedCost: true },
    }),
    prisma.requestLog.groupBy({
      by: ["provider"],
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.requestLog.groupBy({
      by: ["model"],
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCost: true },
    }),
  ]);

  return {
    totalRequests,
    totalTokens: totalTokensAgg._sum.totalTokens ?? 0,
    totalCost: totalCostAgg._sum.estimatedCost ?? 0,
    byProvider: byProvider.map((p) => ({
      provider: p.provider,
      requests: p._count._all,
      tokens: p._sum.totalTokens ?? 0,
      cost: p._sum.estimatedCost ?? 0,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      requests: m._count._all,
      tokens: m._sum.totalTokens ?? 0,
      cost: m._sum.estimatedCost ?? 0,
    })),
  };
}
