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
import { useState } from "react";
import { useLogsQuery, useLogsStatsQuery, type LogsStats, type RequestLog } from "./hooks";

const PAGE_SIZE = 25;

export function LogsPage() {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [offset, setOffset] = useState(0);

  const stats = useLogsStatsQuery();
  const logs = useLogsQuery({
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
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
            size="sm"
            onClick={() => {
              setProvider("");
              setModel("");
              setOffset(0);
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {logs.data ? `${logs.data.total.toLocaleString()} requests` : "Loading..."}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
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
                    <TableCell className="text-xs text-muted-foreground">
                      {row.apiKey.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.latencyMs} ms</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.totalTokens?.toLocaleString() ?? "—"}
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
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    {logs.isLoading ? "Loading..." : "No requests match the current filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Showing {offset + 1}–{offset + (logs.data?.logs.length ?? 0)} of{" "}
              {logs.data?.total ?? 0}
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
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  if (status >= 200 && status < 300) return <Badge>OK</Badge>;
  if (status >= 400 && status < 500) return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
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
          <CardTitle className="text-sm font-medium">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold tabular-nums">
          {stats?.totalTokens.toLocaleString() ?? "—"}
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
