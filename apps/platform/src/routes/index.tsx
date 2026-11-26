import { Badge } from "@mux/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { createFileRoute } from "@tanstack/react-router";
import { useEndpoints } from "@/modules/endpoints/hooks/use-endpoints";
import { useExecutions } from "@/modules/playground/hooks/use-playground";
import { useSources } from "@/modules/sources/hooks/use-sources";
import { useTools } from "@/modules/tools/hooks/use-tools";

function OverviewPage() {
  const { sources } = useSources(false);
  const { tools } = useTools();
  const { endpoints } = useEndpoints(null);
  const { data: logs = [] } = useExecutions(50);

  let cacheableCalls = 0;
  let cacheHits = 0;

  for (const log of logs) {
    if (log.cacheStatus !== "disabled" && log.cacheStatus !== "bypass") {
      cacheableCalls += 1;

      if (log.cacheStatus === "hit" || log.cacheStatus === "stale") {
        cacheHits += 1;
      }
    }
  }

  const hitRate = cacheableCalls > 0 ? Math.round((cacheHits / cacheableCalls) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Unified control plane for external MCP servers, manifest.json code plugins, and Redis tool
          caching.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Tool Sources</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{sources.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Catalog Tools</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{tools.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Virtual Endpoints</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{endpoints.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Recent Cache Hit Rate</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{hitRate}%</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect an MCP Client</CardTitle>
          <CardDescription>
            Point Claude, Cursor, or any Streamable HTTP MCP client at your virtual endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Streamable HTTP</Badge>
            <code className="font-mono text-xs text-foreground">
              {window.location.origin}/mcp/&lt;endpoint-slug&gt;
            </code>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs text-muted-foreground">
            {JSON.stringify(
              {
                mcpServers: {
                  mux: {
                    url: `${window.location.origin}/mcp/${endpoints[0]?.slug ?? "default"}`,
                    headers: {
                      Authorization: "Bearer mux_live_...",
                    },
                  },
                },
              },
              null,
              2,
            )}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: OverviewPage });
