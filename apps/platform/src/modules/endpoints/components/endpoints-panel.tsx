import type { EndpointMode } from "@mux/core/types";
import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { Select } from "@mux/ui/select";
import { Switch } from "@mux/ui/switch";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTools } from "@/modules/tools/hooks/use-tools";
import { useEndpoints } from "../hooks/use-endpoints";

export function EndpointsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { endpoints, isLoading, bindings, createEndpoint, deleteEndpoint, attachTool, detachTool } =
    useEndpoints(selectedId);
  const { tools } = useTools();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<EndpointMode>("direct");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (endpoints.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }

      return;
    }

    const exists = endpoints.some((ep) => ep.id === selectedId);

    if (!exists) {
      setSelectedId(endpoints[0].id);
    }
  }, [endpoints, selectedId]);

  const activeEndpoint = endpoints.find((ep) => ep.id === selectedId) ?? null;
  const attachedToolIds = new Set(bindings.map((b) => b.toolId));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    try {
      const res = await createEndpoint.mutateAsync({
        slug: slug.trim(),
        name: name.trim(),
        mode,
      });

      setSlug("");
      setName("");
      setSelectedId(res.endpoint.id);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to create endpoint.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Virtual MCP Endpoints</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bundle selected MCP &amp; plugin tools into scoped virtual MCP URLs (direct or router
          mode).
        </p>
      </div>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Virtual Endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <Form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-4">
              <Field label="Slug">
                <Input
                  required
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="support-agent"
                />
              </Field>
              <Field label="Display Name">
                <Input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Support Agent"
                />
              </Field>
              <Field label="Exposure Mode">
                <Select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as EndpointMode)}
                >
                  <option value="direct">Direct (expose each tool)</option>
                  <option value="router">Router (3 meta-tools)</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={createEndpoint.isPending} className="w-full">
                  Create Endpoint
                </Button>
              </div>
            </Form>
            {errorMsg ? <p className="mt-3 text-xs text-destructive">{errorMsg}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Endpoints ({endpoints.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading endpoints...</p>
            ) : null}
            {!isLoading && endpoints.length === 0 ? (
              <p className="text-xs text-muted-foreground">No endpoints created yet.</p>
            ) : null}
            {!isLoading && endpoints.length > 0 ? (
              <div className="space-y-2">
                {endpoints.map((ep) => {
                  const isActive = ep.id === selectedId;

                  return (
                    <div
                      key={ep.id}
                      className={`flex items-center justify-between gap-2 rounded-md border p-3 transition-colors ${
                        isActive ? "border-primary bg-accent" : "border-border bg-background"
                      }`}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto flex-1 flex-col items-start p-0 text-left hover:bg-transparent"
                        onClick={() => setSelectedId(ep.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{ep.name}</span>
                          <Badge variant="default">{ep.mode}</Badge>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          /mcp/{ep.slug}
                        </span>
                      </Button>
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteEndpoint.mutate(ep.id)}
                        >
                          <IconTrash size={14} stroke={1.75} />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>
              {activeEndpoint ? `Tools on /mcp/${activeEndpoint.slug}` : "Select an Endpoint"}
            </CardTitle>
            {activeEndpoint ? (
              <CardDescription className="font-mono">
                POST {window.location.origin}/mcp/{activeEndpoint.slug} (Authorization: Bearer
                mux_live_...)
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {!activeEndpoint ? (
              <p className="text-xs text-muted-foreground">
                Create or select an endpoint to manage attached tools.
              </p>
            ) : null}
            {activeEndpoint && tools.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Register an MCP server or code plugin first to discover tools.
              </p>
            ) : null}
            {activeEndpoint && tools.length > 0 ? (
              <div className="divide-y divide-border">
                {tools.map((tool) => {
                  const attached = attachedToolIds.has(tool.id);

                  return (
                    <div
                      key={tool.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium text-foreground">{tool.slug}</p>
                        <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                      <Switch
                        disabled={!isAdmin || attachTool.isPending || detachTool.isPending}
                        checked={attached}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            attachTool.mutate({ endpointId: activeEndpoint.id, toolId: tool.id });
                          } else {
                            detachTool.mutate({ endpointId: activeEndpoint.id, toolId: tool.id });
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
