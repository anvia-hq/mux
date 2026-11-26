import type { ToolCacheStatus } from "@mux/core/types";
import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Select } from "@mux/ui/select";
import { Switch } from "@mux/ui/switch";
import { Textarea } from "@mux/ui/textarea";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useTools } from "@/modules/tools/hooks/use-tools";
import { usePlaygroundExecute } from "../hooks/use-playground";
import type { PlaygroundExecuteOutput } from "../types";

const cacheBadgeVariant = (status: ToolCacheStatus) => {
  if (status === "hit") {
    return "success";
  }

  if (status === "stale" || status === "bypass") {
    return "warning";
  }

  return "muted";
};

export function PlaygroundPanel() {
  const { tools } = useTools();
  const executeMutation = usePlaygroundExecute();
  const [selectedToolId, setSelectedToolId] = useState("");
  const [argsJson, setArgsJson] = useState("{}");
  const [bypassCache, setBypassCache] = useState(false);
  const [output, setOutput] = useState<PlaygroundExecuteOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveToolId = selectedToolId || tools[0]?.id || "";
  const activeTool = tools.find((t) => t.id === effectiveToolId) ?? null;

  const handleRun = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    try {
      if (!effectiveToolId) {
        throw new Error("Select a tool to execute.");
      }

      const parsedArgs = JSON.parse(argsJson) as Record<string, unknown>;
      const res = await executeMutation.mutateAsync({
        toolId: effectiveToolId,
        arguments: parsedArgs,
        bypassCache,
      });

      setOutput(res);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Execution failed.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tool Playground</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoke any MCP or code plugin tool directly and inspect Redis cache hits &amp; latency.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Execute Tool</CardTitle>
            <CardDescription>
              Arguments are validated against the tool&apos;s cached JSON Schema before dispatch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form onSubmit={handleRun} className="space-y-4">
              <Field label="Tool">
                <Select
                  value={effectiveToolId}
                  onChange={(event) => setSelectedToolId(event.target.value)}
                >
                  {tools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.slug}
                    </option>
                  ))}
                </Select>
              </Field>

              {activeTool ? (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-[11px] font-medium text-muted-foreground">Input Schema</p>
                  <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] text-foreground">
                    {JSON.stringify(activeTool.inputSchema, null, 2)}
                  </pre>
                </div>
              ) : null}

              <Field label="Arguments (JSON)">
                <Textarea
                  rows={6}
                  value={argsJson}
                  onChange={(event) => setArgsJson(event.target.value)}
                  className="font-mono text-xs"
                />
              </Field>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Bypass Redis cache</span>
                <Switch checked={bypassCache} onCheckedChange={setBypassCache} />
              </div>

              {errorMsg ? <p className="text-xs text-destructive">{errorMsg}</p> : null}

              <Button
                type="submit"
                disabled={executeMutation.isPending || tools.length === 0}
                className="w-full"
              >
                <IconPlayerPlay size={15} stroke={1.75} />
                <span>{executeMutation.isPending ? "Executing..." : "Run Tool"}</span>
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Response</CardTitle>
              {output ? (
                <div className="flex items-center gap-2">
                  <Badge variant={cacheBadgeVariant(output.cacheStatus)}>
                    {output.cacheStatus.toUpperCase()}
                  </Badge>
                  <Badge variant="muted" className="tabular-nums">
                    {output.durationMs}ms
                  </Badge>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {output ? (
              <pre className="overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs text-foreground">
                {JSON.stringify(output.result, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                Run a tool to view its normalized MCP payload, cache status, and latency.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
