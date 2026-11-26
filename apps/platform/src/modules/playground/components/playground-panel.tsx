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
import { parseJsonObject } from "@/lib/format";
import { useTools } from "@/modules/tools/hooks/use-tools";
import { cacheStatusBadgeVariant } from "../cache-badge";
import { usePlaygroundExecute } from "../hooks/use-playground";
import type { PlaygroundExecuteOutput } from "../types";

export function PlaygroundPanel() {
  const { tools, error: toolsError } = useTools();
  const executeMutation = usePlaygroundExecute();
  const [selectedToolId, setSelectedToolId] = useState("");
  const [argsJson, setArgsJson] = useState("{}");
  const [bypassCache, setBypassCache] = useState(false);
  const [output, setOutput] = useState<PlaygroundExecuteOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedExists = tools.some((tool) => tool.id === selectedToolId);
  const effectiveToolId = selectedExists ? selectedToolId : (tools[0]?.id ?? "");
  const activeTool = tools.find((tool) => tool.id === effectiveToolId) ?? null;

  const handleRun = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setOutput(null);

    try {
      if (!effectiveToolId) {
        throw new Error("Select a tool to execute.");
      }

      const parsedArgs = parseJsonObject(argsJson, "Arguments");
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

      {toolsError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load tools: {toolsError instanceof Error ? toolsError.message : "Unknown error"}
        </div>
      ) : null}

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
                  onChange={(event) => {
                    setSelectedToolId(event.target.value);
                    setOutput(null);
                    setErrorMsg(null);
                  }}
                >
                  {tools.length === 0 ? <option value="">No tools available</option> : null}
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
                <Switch
                  aria-label="Bypass Redis cache"
                  checked={bypassCache}
                  onCheckedChange={setBypassCache}
                />
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
                  {output.result.isError ? <Badge variant="destructive">ERROR</Badge> : null}
                  <Badge variant={cacheStatusBadgeVariant(output.cacheStatus)}>
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
