import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { meQueryOptions } from "../../auth/hooks/use-auth";
import { useLogsStatsQuery, type LogsStats, type StatsRangeDays } from "../../logs/hooks";
import { RequestTrendChart } from "../../logs/request-trend-chart";

export function OverviewPage() {
  const user = useQuery(meQueryOptions).data;
  const [days, setDays] = useState<StatsRangeDays>(30);
  const stats = useLogsStatsQuery({ days });
  const insights = buildOverviewInsights(stats.data, days);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome{user?.name ? `, ${user.name}` : user?.email ? `, ${user.email}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Centralized LLM API gateway with request logging and admin controls.
        </p>
      </div>

      <RequestTrendChart stats={stats.data} days={days} onDaysChange={setDays} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Activity</CardTitle>
            <CardDescription>Request cadence over the last {days} days</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.state === "empty" ? (
              <p className="text-sm text-muted-foreground">No request activity in this range.</p>
            ) : (
              <dl className="grid gap-3 text-sm">
                <InsightRow label="Active days" value={insights.activeDays} />
                <InsightRow label="Busiest day" value={insights.busiestDay} />
                <InsightRow label="Average per active day" value={insights.averageActiveDay} />
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Efficiency</CardTitle>
            <CardDescription>Per-request usage over the last {days} days</CardDescription>
          </CardHeader>
          <CardContent>
            {insights.state === "empty" ? (
              <p className="text-sm text-muted-foreground">
                Efficiency metrics will appear after the first request.
              </p>
            ) : (
              <dl className="grid gap-3 text-sm">
                <InsightRow label="Average tokens per request" value={insights.averageTokens} />
                <InsightRow label="Input token share" value={insights.inputShare} />
                <InsightRow label="Average cost per request" value={insights.averageCost} />
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums sm:text-right">{value}</dd>
    </div>
  );
}

type OverviewInsights = {
  state: "loading" | "empty" | "ready";
  activeDays: string;
  busiestDay: string;
  averageActiveDay: string;
  averageTokens: string;
  inputShare: string;
  averageCost: string;
};

function buildOverviewInsights(
  stats: LogsStats | undefined,
  days: StatsRangeDays,
): OverviewInsights {
  if (!stats) {
    return {
      state: "loading",
      activeDays: "—",
      busiestDay: "—",
      averageActiveDay: "—",
      averageTokens: "—",
      inputShare: "—",
      averageCost: "—",
    };
  }

  if (stats.totalRequests === 0) {
    return {
      state: "empty",
      activeDays: `0 of ${days}`,
      busiestDay: "No activity",
      averageActiveDay: "—",
      averageTokens: "—",
      inputShare: "—",
      averageCost: "—",
    };
  }

  const activeRows = stats.daily.filter((row) => row.requests > 0);
  const busiest = activeRows.reduce<(typeof activeRows)[number] | undefined>(
    (current, row) => (!current || row.requests > current.requests ? row : current),
    undefined,
  );
  const averagePerActiveDay = activeRows.length
    ? stats.totalRequests / activeRows.length
    : undefined;
  const averageTokens = stats.totalTokens / stats.totalRequests;
  const inputShare =
    stats.totalTokens > 0 ? stats.totalPromptTokens / stats.totalTokens : undefined;

  return {
    state: "ready",
    activeDays: `${activeRows.length} of ${days}`,
    busiestDay: busiest
      ? `${formatDateLabel(busiest.date)} · ${formatNumber(busiest.requests)} requests`
      : "No activity",
    averageActiveDay:
      averagePerActiveDay === undefined ? "—" : `${formatNumber(averagePerActiveDay)} requests`,
    averageTokens: formatNumber(averageTokens),
    inputShare: inputShare === undefined ? "—" : `${Math.round(inputShare * 100)}%`,
    averageCost: `$${(stats.totalCost / stats.totalRequests).toFixed(4)}`,
  };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
