import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { meQueryOptions } from "../../auth/hooks/use-auth";
import { useLogsStatsQuery, type StatsRangeDays } from "../../logs/hooks";
import { RequestTrendChart } from "../../logs/request-trend-chart";

export function OverviewPage() {
  const user = useQuery(meQueryOptions).data;
  const [days, setDays] = useState<StatsRangeDays>(30);
  const stats = useLogsStatsQuery({ days });

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
            <CardTitle className="text-sm font-medium">By provider</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.data?.byProvider.length ? (
              <ul className="grid gap-2 text-sm">
                {stats.data.byProvider.map((row) => (
                  <li key={row.provider} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="font-medium">{row.provider}</span>
                    <span className="text-muted-foreground tabular-nums sm:text-right">
                      {row.requests} req ·{" "}
                      {formatTokenSplit(row.promptTokens, row.completionTokens)} · $
                      {row.cost.toFixed(4)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No requests yet. Once traffic flows through the gateway, stats will appear here.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top models</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.data?.byModel.length ? (
              <ul className="grid gap-2 text-sm">
                {stats.data.byModel.slice(0, 5).map((row) => (
                  <li key={row.model} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <span className="min-w-0 truncate font-medium">{row.model}</span>
                    <span className="text-muted-foreground tabular-nums sm:text-right">
                      {row.requests} req ·{" "}
                      {formatTokenSplit(row.promptTokens, row.completionTokens)} · $
                      {row.cost.toFixed(4)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No model usage yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatTokenSplit(promptTokens: number, completionTokens: number) {
  return `${promptTokens.toLocaleString()} input · ${completionTokens.toLocaleString()} output`;
}
