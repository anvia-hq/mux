import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { Select } from "@mux/ui/select";
import { Textarea } from "@mux/ui/textarea";
import {
  IconCode,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatTimestamp, parseJsonObject, parseKeyValueLines } from "@/lib/format";
import { useSources } from "../hooks/use-sources";
import type { SourceItem } from "../types";

const DEFAULT_MANIFEST_JSON = JSON.stringify(
  {
    name: "custom-plugin",
    version: "1.0.0",
    description: "Custom code plugin",
    entry: "./index.ts",
    secrets: [],
    timeoutMs: 5000,
    tools: [
      {
        name: "hello",
        description: "Return a greeting message",
        handler: "sayHello",
        readOnly: true,
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        cache: { mode: "ttl", ttlSeconds: 60 },
      },
    ],
  },
  null,
  2,
);

const DEFAULT_PLUGIN_CODE =
  "export const sayHello = ({ name }: { name: string }) => ({\n  message: `Hello, ${name}!`,\n});\n";

const statusBadgeVariant = (status: SourceItem["status"]) => {
  if (status === "active") {
    return "success";
  }

  if (status === "error") {
    return "destructive";
  }

  return "muted";
};

export function SourcesPanel({ isAdmin }: { isAdmin: boolean }) {
  const {
    sources,
    isLoading,
    error: queryError,
    localPlugins,
    registerMcp,
    registerLocalPlugin,
    uploadPlugin,
    syncSource,
    toggleStatus,
    deleteSource,
  } = useSources(isAdmin);

  const [tab, setTab] = useState<"mcp" | "local" | "upload">("mcp");
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "warn" | "err";
    message: string;
  } | null>(null);

  const [mcpSlug, setMcpSlug] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpHeaders, setMcpHeaders] = useState("");

  const [selectedLocalDir, setSelectedLocalDir] = useState("");
  const [localSecrets, setLocalSecrets] = useState("");

  const [uploadManifest, setUploadManifest] = useState(DEFAULT_MANIFEST_JSON);
  const [uploadEntryPath, setUploadEntryPath] = useState("index.ts");
  const [uploadCode, setUploadCode] = useState(DEFAULT_PLUGIN_CODE);
  const [uploadSecrets, setUploadSecrets] = useState("");

  const selectTab = (next: "mcp" | "local" | "upload") => {
    setFeedback(null);
    setTab(next);
  };

  const handleRegisterMcp = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    try {
      const headers = mcpHeaders.trim().length > 0 ? parseKeyValueLines(mcpHeaders) : undefined;
      const result = await registerMcp.mutateAsync({
        slug: mcpSlug.trim(),
        name: mcpName.trim(),
        url: mcpUrl.trim(),
        headers,
      });

      setMcpSlug("");
      setMcpName("");
      setMcpUrl("");
      setMcpHeaders("");

      if (result.syncError) {
        setFeedback({
          kind: "warn",
          message: `MCP server saved, but initial sync failed: ${result.syncError}`,
        });
      } else {
        setFeedback({
          kind: "ok",
          message: `MCP server registered and synced (${result.syncedToolsCount} tools).`,
        });
      }
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to register MCP server.",
      });
    }
  };

  const handleRegisterLocal = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    try {
      const dir = selectedLocalDir || localPlugins[0]?.directoryName || "";

      if (dir.length === 0) {
        throw new Error("Select a local plugin directory.");
      }

      const secrets = localSecrets.trim().length > 0 ? parseKeyValueLines(localSecrets) : undefined;

      await registerLocalPlugin.mutateAsync({ directoryName: dir, secrets });
      setLocalSecrets("");
      setFeedback({ kind: "ok", message: `Local plugin '${dir}' registered.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to register local plugin.",
      });
    }
  };

  const handleUploadPlugin = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    try {
      const manifest = parseJsonObject(uploadManifest, "manifest.json");
      const secrets =
        uploadSecrets.trim().length > 0 ? parseKeyValueLines(uploadSecrets) : undefined;

      await uploadPlugin.mutateAsync({
        manifest,
        files: [{ path: uploadEntryPath.trim(), content: uploadCode }],
        secrets,
      });
      setUploadSecrets("");
      setFeedback({ kind: "ok", message: "Code plugin uploaded and tools synced." });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to upload plugin bundle.",
      });
    }
  };

  const handleRowSync = async (source: SourceItem) => {
    setFeedback(null);

    try {
      await syncSource.mutateAsync(source.id);
      setFeedback({ kind: "ok", message: `Synced '${source.name}'.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : `Failed to sync '${source.name}'.`,
      });
    }
  };

  const handleRowToggle = async (source: SourceItem) => {
    setFeedback(null);

    try {
      const nextStatus = source.status === "disabled" ? "active" : "disabled";

      await toggleStatus.mutateAsync({ id: source.id, status: nextStatus });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to update source status.",
      });
    }
  };

  const handleRowDelete = async (source: SourceItem) => {
    setFeedback(null);

    try {
      await deleteSource.mutateAsync(source.id);
      setFeedback({ kind: "ok", message: `Deleted source '${source.name}'.` });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to delete source.",
      });
    }
  };

  let feedbackStyle = "border-destructive/30 bg-destructive/10 text-destructive";

  if (feedback?.kind === "ok") {
    feedbackStyle = "border-success/30 bg-success/10 text-success";
  } else if (feedback?.kind === "warn") {
    feedbackStyle = "border-warning/30 bg-warning/10 text-warning";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register external Streamable HTTP MCP servers and manifest.json code plugins.
        </p>
      </div>

      {queryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load sources:{" "}
          {queryError instanceof Error ? queryError.message : "Unknown error"}
        </div>
      ) : null}

      {feedback ? (
        <div className={`rounded-md border px-3.5 py-2.5 text-xs ${feedbackStyle}`}>
          {feedback.message}
        </div>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Add Tool Source</CardTitle>
                <CardDescription>
                  Connect an external MCP server or expose custom code plugin tools.
                </CardDescription>
              </div>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={tab === "mcp" ? "primary" : "secondary"}
                  onClick={() => selectTab("mcp")}
                >
                  <IconPlugConnected size={14} stroke={1.75} />
                  <span>Remote MCP</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tab === "local" ? "primary" : "secondary"}
                  onClick={() => selectTab("local")}
                >
                  <IconCode size={14} stroke={1.75} />
                  <span>Local Plugin</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tab === "upload" ? "primary" : "secondary"}
                  onClick={() => selectTab("upload")}
                >
                  <IconUpload size={14} stroke={1.75} />
                  <span>Upload Plugin</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tab === "mcp" ? (
              <Form onSubmit={handleRegisterMcp} className="grid gap-4 md:grid-cols-2">
                <Field label="Slug" hint="Lowercase identifier used as tool prefix (e.g. github)">
                  <Input
                    required
                    value={mcpSlug}
                    onChange={(event) => setMcpSlug(event.target.value)}
                    placeholder="github"
                  />
                </Field>
                <Field label="Display Name">
                  <Input
                    required
                    value={mcpName}
                    onChange={(event) => setMcpName(event.target.value)}
                    placeholder="GitHub MCP"
                  />
                </Field>
                <Field label="Streamable HTTP URL" className="md:col-span-2">
                  <Input
                    required
                    value={mcpUrl}
                    onChange={(event) => setMcpUrl(event.target.value)}
                    placeholder="https://mcp.example.com/mcp"
                  />
                </Field>
                <Field
                  label="Auth Headers (optional, encrypted at rest)"
                  hint="One per line: Authorization: Bearer ..."
                  className="md:col-span-2"
                >
                  <Textarea
                    rows={3}
                    value={mcpHeaders}
                    onChange={(event) => setMcpHeaders(event.target.value)}
                    placeholder="Authorization: Bearer sk_..."
                    className="font-mono text-xs"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Button type="submit" disabled={registerMcp.isPending}>
                    {registerMcp.isPending ? "Registering..." : "Register & Sync MCP"}
                  </Button>
                </div>
              </Form>
            ) : null}

            {tab === "local" ? (
              <Form onSubmit={handleRegisterLocal} className="space-y-4">
                <Field
                  label="Discovered Local Plugin"
                  hint="Loaded from the workspace plugins/ directory"
                >
                  <Select
                    value={selectedLocalDir || localPlugins[0]?.directoryName || ""}
                    onChange={(event) => setSelectedLocalDir(event.target.value)}
                  >
                    {localPlugins.length === 0 ? (
                      <option value="">No local plugins found in plugins/</option>
                    ) : (
                      localPlugins.map((plugin) => (
                        <option key={plugin.directoryName} value={plugin.directoryName}>
                          {plugin.directoryName} (v{plugin.version} — {plugin.toolCount} tools)
                        </option>
                      ))
                    )}
                  </Select>
                </Field>
                <Field
                  label="Plugin Secrets (optional, encrypted at rest)"
                  hint="One per line: SECRET_NAME=value"
                >
                  <Textarea
                    rows={3}
                    value={localSecrets}
                    onChange={(event) => setLocalSecrets(event.target.value)}
                    placeholder="STRIPE_API_KEY=sk_live_..."
                    className="font-mono text-xs"
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={registerLocalPlugin.isPending || localPlugins.length === 0}
                >
                  {registerLocalPlugin.isPending ? "Registering..." : "Register Local Plugin"}
                </Button>
              </Form>
            ) : null}

            {tab === "upload" ? (
              <Form onSubmit={handleUploadPlugin} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="manifest.json">
                    <Textarea
                      rows={12}
                      value={uploadManifest}
                      onChange={(event) => setUploadManifest(event.target.value)}
                      className="font-mono text-xs"
                    />
                  </Field>
                  <div className="space-y-4">
                    <Field label="Entry File Path">
                      <Input
                        value={uploadEntryPath}
                        onChange={(event) => setUploadEntryPath(event.target.value)}
                        className="font-mono text-xs"
                      />
                    </Field>
                    <Field label="Handler Code (TypeScript / JavaScript)">
                      <Textarea
                        rows={8}
                        value={uploadCode}
                        onChange={(event) => setUploadCode(event.target.value)}
                        className="font-mono text-xs"
                      />
                    </Field>
                  </div>
                </div>
                <Field label="Plugin Secrets (optional)" hint="One per line: SECRET_NAME=value">
                  <Textarea
                    rows={2}
                    value={uploadSecrets}
                    onChange={(event) => setUploadSecrets(event.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
                <Button type="submit" disabled={uploadPlugin.isPending}>
                  {uploadPlugin.isPending ? "Uploading..." : "Upload & Activate Plugin"}
                </Button>
              </Form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Registered Sources ({sources.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-xs text-muted-foreground">Loading sources...</p> : null}
          {!isLoading && !queryError && sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No MCP servers or code plugins registered yet.
            </p>
          ) : null}
          {!isLoading && sources.length > 0 ? (
            <div className="divide-y divide-border">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{source.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{source.slug}</span>
                      <Badge variant={statusBadgeVariant(source.status)}>{source.status}</Badge>
                      <Badge variant="muted">
                        {source.kind === "mcp_remote" ? "MCP Remote" : "Code Plugin"}
                      </Badge>
                      {source.hasSecrets ? (
                        <Badge variant="default">Encrypted Secrets</Badge>
                      ) : null}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {source.config.kind === "mcp_remote"
                        ? source.config.url
                        : `${source.config.origin}://${source.config.directoryName}/${source.config.entry} (v${source.config.version})`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Last synced: {formatTimestamp(source.lastSyncedAt)}
                    </p>
                    {source.lastError ? (
                      <p className="text-xs text-destructive">{source.lastError}</p>
                    ) : null}
                  </div>

                  {isAdmin ? (
                    <div className="flex items-center gap-2">
                      {source.config.kind === "mcp_remote" || source.config.origin === "local" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={syncSource.isPending}
                          onClick={() => void handleRowSync(source)}
                        >
                          <IconRefresh size={14} stroke={1.75} />
                          <span>Sync</span>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={toggleStatus.isPending}
                        onClick={() => void handleRowToggle(source)}
                      >
                        {source.status === "disabled" ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        aria-label={`Delete source ${source.name}`}
                        disabled={deleteSource.isPending}
                        onClick={() => void handleRowDelete(source)}
                      >
                        <IconTrash size={14} stroke={1.75} />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
