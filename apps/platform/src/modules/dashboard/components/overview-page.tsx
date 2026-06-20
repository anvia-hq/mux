import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { meQueryOptions } from "../../auth/hooks/use-auth";
import { apiFetch } from "../../../lib/api-client";

type StatsResponse = {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Array<{ provider: string; requests: number; tokens: number; cost: number }>;
  byModel: Array<{ model: string; requests: number; tokens: number; cost: number }>;
};

export function OverviewPage() {
  const user = useQuery(meQueryOptions).data;
  const stats = useQuery<StatsResponse>({
    queryKey: ["logs", "stats"],
    queryFn: () => apiFetch<StatsResponse>("/logs/stats"),
    refetchInterval: 15_000,
  });

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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {stats.data?.totalRequests ?? "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {stats.data?.totalTokens.toLocaleString() ?? "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Estimated cost</CardTitle>
            <CardDescription>USD across all requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              ${stats.data?.totalCost.toFixed(4) ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">By provider</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.data?.byProvider.length ? (
              <ul className="grid gap-2 text-sm">
                {stats.data.byProvider.map((row) => (
                  <li key={row.provider} className="flex items-center justify-between">
                    <span className="font-medium">{row.provider}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.requests} req · {row.tokens.toLocaleString()} tok · ${row.cost.toFixed(4)}
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
                  <li key={row.model} className="flex items-center justify-between">
                    <span className="font-medium">{row.model}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {row.requests} req · ${row.cost.toFixed(4)}
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
