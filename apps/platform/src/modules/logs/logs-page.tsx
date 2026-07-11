import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
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
    model: model || undefined,
  });
  const logs = useLogsQuery({
    userId: isAdmin ? userId || undefined : undefined,
    apiKeyId: isAdmin ? apiKeyId || undefined : undefined,
    model: model || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Request logs</h1>
        <p className="text-sm text-muted-foreground">
          Each logged row reports cost and upstream-attempt latency. Streaming latency is measured
          to the first upstream chunk or byte.
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
              setModel("");
              setOffset(0);
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden p-0">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Upstream latency</TableHead>
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
                    <PricingAuditCost row={row} />
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={row.statusCode} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
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

function PricingAuditCost({ row }: { row: RequestLog }) {
  const label = row.estimatedCost === null ? "—" : `$${row.estimatedCost.toFixed(4)}`;
  if (
    row.pricingInputTokens === null ||
    row.appliedInputPricePer1M === null ||
    row.appliedOutputPricePer1M === null
  ) {
    return label;
  }

  const tierLabel =
    row.appliedPricingTierThreshold === null
      ? "Base pricing"
      : `Long-context tier above ${row.appliedPricingTierThreshold.toLocaleString()} input tokens`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
          {label}
        </TooltipTrigger>
        <TooltipContent className="grid gap-1 text-xs">
          <span className="font-medium">{tierLabel}</span>
          <span>{row.pricingInputTokens.toLocaleString()} tokens used for tier selection</span>
          <span>
            ${row.appliedInputPricePer1M.toLocaleString()}/M input · $
            {row.appliedOutputPricePer1M.toLocaleString()}/M output
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
    <div className="grid gap-4 md:grid-cols-4">
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
    </div>
  );
}
