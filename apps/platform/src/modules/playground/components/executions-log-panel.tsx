import { Badge } from "@mux/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@mux/ui/card";
import { formatTimestamp } from "@/lib/format";
import { cacheStatusBadgeVariant } from "../cache-badge";
import { useExecutions } from "../hooks/use-playground";

export function ExecutionsLogPanel() {
  const { data: logs = [], isPending, error } = useExecutions(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Execution Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail of MCP gateway and playground executions with sensitive arguments redacted.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load execution logs: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent Executions ({logs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending ? <p className="text-xs text-muted-foreground">Loading logs...</p> : null}
          {!isPending && !error && logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tool executions recorded yet.</p>
          ) : null}
          {!isPending && logs.length > 0 ? (
            <div className="divide-y divide-border">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {log.toolSlug}
                      </span>
                      <Badge variant={log.status === "success" ? "success" : "destructive"}>
                        {log.status}
                      </Badge>
                      <Badge variant={cacheStatusBadgeVariant(log.cacheStatus)}>
                        {log.cacheStatus}
                      </Badge>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {log.durationMs}ms
                      </span>
                    </div>
                    {log.argsSummary ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {JSON.stringify(log.argsSummary)}
                      </p>
                    ) : null}
                    {log.errorMessage ? (
                      <p className="text-xs text-destructive">{log.errorMessage}</p>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTimestamp(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
