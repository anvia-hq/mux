import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiKeysQuery } from "../api-keys/hooks";
import { meQueryOptions } from "../auth/hooks/use-auth";
import { useUsersQuery, type DashboardUser } from "../users/hooks";
import {
  useLogsQuery,
  useLogsStatsQuery,
  type LogsStats,
  type RequestLog,
  type StatsRangeDays,
} from "./hooks";
import { RequestTrendChart } from "./request-trend-chart";

const PAGE_SIZE = 25;

export function LogsPage() {
  const currentUser = useQuery(meQueryOptions).data;
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [userId, setUserId] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState<StatsRangeDays>(30);
  const isAdmin = currentUser?.role === "ADMIN";
  const usersQuery = useUsersQuery({ enabled: isAdmin });
  const apiKeysQuery = useApiKeysQuery({ enabled: isAdmin });
  const apiKeys = apiKeysQuery.data?.keys ?? [];
  const filteredApiKeys = useMemo(
    () => (userId ? apiKeys.filter((key) => key.createdBy === userId) : apiKeys),
    [apiKeys, userId],
  );

  const stats = useLogsStatsQuery({
    days,
    userId: isAdmin ? userId || undefined : undefined,
    apiKeyId: isAdmin ? apiKeyId || undefined : undefined,
    provider: provider || undefined,
    model: model || undefined,
  });
  const logs = useLogsQuery({
    userId: isAdmin ? userId || undefined : undefined,
    apiKeyId: isAdmin ? apiKeyId || undefined : undefined,
    provider: provider || undefined,
    model: model || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Request logs</h1>
        <p className="text-sm text-muted-foreground">
          Every chat completion that flows through the gateway is logged with cost and latency.
        </p>
      </div>

      <StatsRow stats={stats.data} />

      <RequestTrendChart
        stats={stats.data}
        days={days}
        onDaysChange={setDays}
        title="Filtered requests"
        description="Daily traffic for the current log view"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          {isAdmin ? (
            <>
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">User</span>
                <Select
                  value={userId || "all"}
                  onValueChange={(value) => {
                    setUserId(value === "all" ? "" : value);
                    setApiKeyId("");
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    {(usersQuery.data?.users ?? []).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {formatUserOption(user)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">API key</span>
                <Select
                  value={apiKeyId || "all"}
                  onValueChange={(value) => {
                    setApiKeyId(value === "all" ? "" : value);
                    setOffset(0);
                  }}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All API keys</SelectItem>
                    {filteredApiKeys.map((key) => (
                      <SelectItem key={key.id} value={key.id}>
                        {key.name} · {key.creator.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Provider</span>
            <Select
              value={provider || "all"}
              onValueChange={(value) => {
                setProvider(value === "all" ? "" : value);
                setOffset(0);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {(stats.data?.byProvider ?? []).map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>
                    {p.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Model</span>
            <Input
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setOffset(0);
              }}
              placeholder="gpt-4o, claude-..."
              className="w-60"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setUserId("");
              setApiKeyId("");
              setProvider("");
              setModel("");
              setOffset(0);
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden p-0">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.data?.logs.length ? (
              logs.data.logs.map((row: RequestLog) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{row.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{row.model}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.apiKey.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.latencyMs} ms</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.promptTokens?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.completionTokens?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    ${row.estimatedCost?.toFixed(4) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={row.statusCode} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  {logs.isLoading ? "Loading..." : "No requests match the current filters."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t p-4">
          <span className="text-xs text-muted-foreground">
            Showing {offset + 1}–{offset + (logs.data?.logs.length ?? 0)} of {logs.data?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!logs.data || offset + PAGE_SIZE >= logs.data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  if (status >= 200 && status < 300) return <Badge>OK</Badge>;
  if (status >= 400 && status < 500) return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

function formatUserOption(user: DashboardUser) {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

function StatsRow({ stats }: { stats: LogsStats | undefined }) {
  return (
    <div className="grid gap-4 md:grid-cols-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Requests</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          {stats?.totalRequests.toLocaleString() ?? "—"}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Input tokens</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          {stats?.totalPromptTokens.toLocaleString() ?? "—"}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Output tokens</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          {stats?.totalCompletionTokens.toLocaleString() ?? "—"}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Cost (USD)</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          ${stats?.totalCost.toFixed(4) ?? "—"}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Providers</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          {stats?.byProvider.length ?? 0}
        </CardContent>
        <CardDescription className="text-xs">
          {stats?.byProvider.map((p) => p.provider).join(", ") || "None"}
        </CardDescription>
      </Card>
    </div>
  );
}
