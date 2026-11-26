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
  const {
    endpoints,
    isLoading,
    error: queryError,
    bindings,
    isLoadingBindings,
    bindingsError,
    createEndpoint,
    updateEndpoint,
    deleteEndpoint,
    attachTool,
    detachTool,
  } = useEndpoints(selectedId);
  const { tools } = useTools();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<EndpointMode>("direct");
  const [editName, setEditName] = useState("");
  const [editMode, setEditMode] = useState<EndpointMode>("direct");
  const [editEnabled, setEditEnabled] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

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

  useEffect(() => {
    if (!activeEndpoint) {
      return;
    }

    setEditName(activeEndpoint.name);
    setEditMode(activeEndpoint.mode);
    setEditEnabled(activeEndpoint.enabled);
  }, [activeEndpoint]);

  const attachedToolIds = new Set(bindings.map((b) => b.toolId));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    try {
      const res = await createEndpoint.mutateAsync({
        slug: slug.trim(),
        name: name.trim(),
        mode,
      });

      setSlug("");
      setName("");
      setSelectedId(res.endpoint.id);
      setFeedback({ kind: "ok", message: `Created endpoint /mcp/${res.endpoint.slug}.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to create endpoint.",
      });
    }
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (!activeEndpoint) {
      return;
    }

    try {
      await updateEndpoint.mutateAsync({
        id: activeEndpoint.id,
        name: editName.trim(),
        mode: editMode,
        enabled: editEnabled,
      });
      setFeedback({ kind: "ok", message: `Updated endpoint /mcp/${activeEndpoint.slug}.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to update endpoint.",
      });
    }
  };

  const handleDelete = async (endpointId: string, endpointSlug: string) => {
    setFeedback(null);

    try {
      await deleteEndpoint.mutateAsync(endpointId);
      setFeedback({ kind: "ok", message: `Deleted endpoint /mcp/${endpointSlug}.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to delete endpoint.",
      });
    }
  };

  const handleToggleTool = async (endpointId: string, toolId: string, attach: boolean) => {
    setFeedback(null);

    try {
      if (attach) {
        await attachTool.mutateAsync({ endpointId, toolId });
      } else {
        await detachTool.mutateAsync({ endpointId, toolId });
      }
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to update endpoint tools.",
      });
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

      {queryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load endpoints:{" "}
          {queryError instanceof Error ? queryError.message : "Unknown error"}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`rounded-md border px-3.5 py-2.5 text-xs ${
            feedback.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

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
            {!isLoading && !queryError && endpoints.length === 0 ? (
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
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto flex-1 flex-col items-start p-0 text-left hover:bg-transparent"
                        onClick={() => setSelectedId(ep.id)}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{ep.name}</span>
                          <Badge variant="default">{ep.mode}</Badge>
                          {!ep.enabled ? <Badge variant="muted">disabled</Badge> : null}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          /mcp/{ep.slug}
                        </span>
                      </Button>
                      {isAdmin ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete endpoint ${ep.slug}`}
                          disabled={deleteEndpoint.isPending}
                          onClick={() => void handleDelete(ep.id, ep.slug)}
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
              {activeEndpoint ? `Endpoint /mcp/${activeEndpoint.slug}` : "Select an Endpoint"}
            </CardTitle>
            {activeEndpoint ? (
              <CardDescription className="font-mono">
                POST {window.location.origin}/mcp/{activeEndpoint.slug} (Authorization: Bearer
                mux_live_...)
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {activeEndpoint && isAdmin ? (
              <Form
                onSubmit={handleUpdate}
                className="grid gap-3 rounded-md border border-border bg-muted/40 p-4 md:grid-cols-4"
              >
                <Field label="Name">
                  <Input
                    required
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </Field>
                <Field label="Mode">
                  <Select
                    value={editMode}
                    onChange={(event) => setEditMode(event.target.value as EndpointMode)}
                  >
                    <option value="direct">Direct</option>
                    <option value="router">Router</option>
                  </Select>
                </Field>
                <div className="flex flex-col justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Enabled</span>
                  <Switch
                    aria-label="Enable or disable endpoint"
                    checked={editEnabled}
                    onCheckedChange={setEditEnabled}
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" size="sm" disabled={updateEndpoint.isPending}>
                    Save Changes
                  </Button>
                </div>
              </Form>
            ) : null}

            {!activeEndpoint ? (
              <p className="text-xs text-muted-foreground">
                Create or select an endpoint to manage attached tools.
              </p>
            ) : null}
            {activeEndpoint && bindingsError ? (
              <p className="text-xs text-destructive">
                Failed to load attached tools:{" "}
                {bindingsError instanceof Error ? bindingsError.message : "Unknown error"}
              </p>
            ) : null}
            {activeEndpoint && isLoadingBindings ? (
              <p className="text-xs text-muted-foreground">Loading attached tools...</p>
            ) : null}
            {activeEndpoint && !isLoadingBindings && tools.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Register an MCP server or code plugin first to discover tools.
              </p>
            ) : null}
            {activeEndpoint && !isLoadingBindings && tools.length > 0 ? (
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
                        aria-label={`Attach or detach ${tool.slug}`}
                        disabled={!isAdmin || attachTool.isPending || detachTool.isPending}
                        checked={attached}
                        onCheckedChange={(checked) =>
                          void handleToggleTool(activeEndpoint.id, tool.id, checked)
                        }
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
