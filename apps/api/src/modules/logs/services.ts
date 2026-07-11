import { Prisma } from "@prisma/client";
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
  ownerUserId?: string;
};

/**
 * Aggregation bucket returned for {@link getStats}. Token and cost fields are
 * summed across the matching logs and are zero (not null) when no logs match.
 */
export type GroupedStat = {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
};

export type DailyStat = {
  date: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
};

/**
 * Shape returned by {@link getStats}. Aggregates are computed across the full
 * filtered set as well as broken down by provider and model.
 */
export type Stats = {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  byProvider: Array<{ provider: string } & GroupedStat>;
  byModel: Array<{ model: string } & GroupedStat>;
  daily: DailyStat[];
};

/**
 * Translate the public {@link LogFilters} shape into a Prisma `where` clause.
 * Centralized here so the query builders stay in sync with the filter type.
 */
function buildLogWhere(filters: LogFilters): Prisma.RequestLogWhereInput {
  const where: Prisma.RequestLogWhereInput = {};

  if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
  if (filters.ownerUserId) where.apiKey = { createdBy: filters.ownerUserId };
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
        pricingInputTokens: true,
        appliedInputPricePer1M: true,
        appliedOutputPricePer1M: true,
        appliedPricingTierThreshold: true,
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
  apiKeyId?: string;
  provider?: string;
  model?: string;
  days?: number;
  groupBy?: "provider" | "model" | "apiKey";
  ownerUserId?: string;
};

const DEFAULT_STATS_DAYS = 30;
const ALLOWED_STATS_DAYS = new Set([7, 30, 90]);

function normalizeStatsDays(days: number | undefined) {
  return days && ALLOWED_STATS_DAYS.has(days) ? days : DEFAULT_STATS_DAYS;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildStatsRange(filters: StatsFilters) {
  const days = normalizeStatsDays(filters.days);
  const endDate = filters.endDate ?? new Date();
  const endDay = startOfUtcDay(endDate);
  const startDate =
    filters.startDate ?? new Date(endDay.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  return { days, startDate, endDate };
}

function buildStatsWhere(filters: StatsFilters, startDate: Date, endDate: Date) {
  const where: Prisma.RequestLogWhereInput = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
  if (filters.provider) where.provider = filters.provider;
  if (filters.model) where.model = filters.model;
  if (filters.ownerUserId) where.apiKey = { createdBy: filters.ownerUserId };

  return where;
}

type DailyRow = {
  date: string | Date;
  requests: number | bigint;
  tokens: number | bigint | null;
  promptTokens: number | bigint | null;
  completionTokens: number | bigint | null;
  cost: number | null;
};

function toNumber(value: number | bigint | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

function buildDailySeries(rows: DailyRow[], days: number, startDate: Date): DailyStat[] {
  const byDate = new Map(
    rows.map((row) => {
      const date =
        row.date instanceof Date ? formatDateKey(row.date) : String(row.date).slice(0, 10);

      return [
        date,
        {
          date,
          requests: toNumber(row.requests),
          tokens: toNumber(row.tokens),
          promptTokens: toNumber(row.promptTokens),
          completionTokens: toNumber(row.completionTokens),
          cost: row.cost ?? 0,
        },
      ] as const;
    }),
  );

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000);
    const dateKey = formatDateKey(date);
    return (
      byDate.get(dateKey) ?? {
        date: dateKey,
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
      }
    );
  });
}

/**
 * Compute aggregate request statistics over the filtered log set.
 *
 * Runs the totals and per-group aggregations in parallel. Nullable summed
 * fields are normalized to `0` so consumers do not need to defend against
 * null in the response shape.
 */
export async function getStats(filters: StatsFilters): Promise<Stats> {
  const { days, startDate, endDate } = buildStatsRange(filters);
  const where = buildStatsWhere(filters, startDate, endDate);
  const providerFilter = filters.provider
    ? Prisma.sql`AND "provider" = ${filters.provider}`
    : Prisma.empty;
  const modelFilter = filters.model ? Prisma.sql`AND "model" = ${filters.model}` : Prisma.empty;
  const apiKeyFilter = filters.apiKeyId
    ? Prisma.sql`AND "apiKeyId" = ${filters.apiKeyId}`
    : Prisma.empty;
  const ownerFilter = filters.ownerUserId
    ? Prisma.sql`AND EXISTS (
        SELECT 1
        FROM "ApiKey"
        WHERE "ApiKey"."id" = "RequestLog"."apiKeyId"
          AND "ApiKey"."createdBy" = ${filters.ownerUserId}
      )`
    : Prisma.empty;

  const [totalRequests, totalTokensAgg, totalCostAgg, byProvider, byModel, dailyRows] =
    await Promise.all([
      prisma.requestLog.count({ where }),
      prisma.requestLog.aggregate({
        where,
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      }),
      prisma.requestLog.aggregate({
        where,
        _sum: { estimatedCost: true },
      }),
      prisma.requestLog.groupBy({
        by: ["provider"],
        where,
        _count: { _all: true },
        _sum: {
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
          estimatedCost: true,
        },
      }),
      prisma.requestLog.groupBy({
        by: ["model"],
        where,
        _count: { _all: true },
        _sum: {
          totalTokens: true,
          promptTokens: true,
          completionTokens: true,
          estimatedCost: true,
        },
      }),
      prisma.$queryRaw<DailyRow[]>`
        SELECT
          DATE("createdAt")::text AS "date",
          COUNT(*)::int AS "requests",
          COALESCE(SUM("totalTokens"), 0)::int AS "tokens",
          COALESCE(SUM("promptTokens"), 0)::int AS "promptTokens",
          COALESCE(SUM("completionTokens"), 0)::int AS "completionTokens",
          COALESCE(SUM("estimatedCost"), 0)::float8 AS "cost"
        FROM "RequestLog"
        WHERE "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
          ${providerFilter}
          ${modelFilter}
          ${apiKeyFilter}
          ${ownerFilter}
        GROUP BY DATE("createdAt")
        ORDER BY DATE("createdAt") ASC
      `,
    ]);

  return {
    totalRequests,
    totalTokens: totalTokensAgg._sum.totalTokens ?? 0,
    totalPromptTokens: totalTokensAgg._sum.promptTokens ?? 0,
    totalCompletionTokens: totalTokensAgg._sum.completionTokens ?? 0,
    totalCost: totalCostAgg._sum.estimatedCost ?? 0,
    byProvider: byProvider.map((p) => ({
      provider: p.provider,
      requests: p._count._all,
      tokens: p._sum.totalTokens ?? 0,
      promptTokens: p._sum.promptTokens ?? 0,
      completionTokens: p._sum.completionTokens ?? 0,
      cost: p._sum.estimatedCost ?? 0,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      requests: m._count._all,
      tokens: m._sum.totalTokens ?? 0,
      promptTokens: m._sum.promptTokens ?? 0,
      completionTokens: m._sum.completionTokens ?? 0,
      cost: m._sum.estimatedCost ?? 0,
    })),
    daily: buildDailySeries(dailyRows, days, startDate),
  };
}
