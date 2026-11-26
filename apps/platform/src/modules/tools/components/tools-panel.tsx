import type { ToolCacheMode, ToolCachePolicy } from "@mux/core/types";
import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { Select } from "@mux/ui/select";
import { Switch } from "@mux/ui/switch";
import { IconDatabaseOff } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { parseCommaTags } from "@/lib/format";
import { useTools } from "../hooks/use-tools";
import type { ToolItem } from "../types";

export function ToolsPanel({ isAdmin }: { isAdmin: boolean }) {
  const {
    tools,
    isLoading,
    error: queryError,
    updateTool,
    invalidateToolCache,
    invalidateTagCache,
  } = useTools();
  const [search, setSearch] = useState("");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [cacheMode, setCacheMode] = useState<ToolCacheMode>("off");
  const [ttlSeconds, setTtlSeconds] = useState("60");
  const [staleSeconds, setStaleSeconds] = useState("60");
  const [allowBypass, setAllowBypass] = useState(true);
  const [tagsInput, setTagsInput] = useState("");
  const [purgeTag, setPurgeTag] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const filteredTools = tools.filter((tool) => {
    const q = search.trim().toLowerCase();

    if (q.length === 0) {
      return true;
    }

    return tool.slug.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q);
  });

  const startEditing = (tool: ToolItem) => {
    setSelectedToolId(tool.id);
    setCacheMode(tool.cachePolicy.mode);
    setTtlSeconds(String(tool.cachePolicy.ttlSeconds));
    setStaleSeconds(String(tool.cachePolicy.staleSeconds ?? tool.cachePolicy.ttlSeconds));
    setAllowBypass(tool.cachePolicy.allowBypass !== false);
    setTagsInput((tool.cachePolicy.tags ?? []).join(", "));
    setFeedback(null);
  };

  const handleSaveCachePolicy = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (!selectedToolId) {
      return;
    }

    const existingTool = tools.find((tool) => tool.id === selectedToolId);
    const parsedTtl = Number.parseInt(ttlSeconds, 10);

    if (!Number.isInteger(parsedTtl) || parsedTtl < 1 || parsedTtl > 86_400) {
      setFeedback({ kind: "err", message: "TTL must be an integer between 1 and 86400 seconds." });

      return;
    }

    let parsedStale: number | undefined;

    if (cacheMode === "stale_while_revalidate") {
      const candidate = Number.parseInt(staleSeconds, 10);

      if (!Number.isInteger(candidate) || candidate < 0 || candidate > 86_400) {
        setFeedback({
          kind: "err",
          message: "Stale window must be an integer between 0 and 86400 seconds.",
        });

        return;
      }

      parsedStale = candidate;
    }

    const tags = parseCommaTags(tagsInput);
    const nextPolicy: ToolCachePolicy = {
      mode: cacheMode,
      ttlSeconds: parsedTtl,
      allowBypass,
    };

    if (parsedStale !== undefined) {
      nextPolicy.staleSeconds = parsedStale;
    }

    if (existingTool?.cachePolicy.maxPayloadBytes !== undefined) {
      nextPolicy.maxPayloadBytes = existingTool.cachePolicy.maxPayloadBytes;
    }

    if (tags.length > 0) {
      nextPolicy.tags = tags;
    }

    try {
      await updateTool.mutateAsync({
        id: selectedToolId,
        cachePolicy: nextPolicy,
      });
      setFeedback({
        kind: "ok",
        message: "Updated Redis cache policy and invalidated stale entries.",
      });
      setSelectedToolId(null);
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to update cache policy.",
      });
    }
  };

  const handleToggleTool = async (tool: ToolItem, enabled: boolean) => {
    setFeedback(null);

    try {
      await updateTool.mutateAsync({ id: tool.id, enabled });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to toggle tool state.",
      });
    }
  };

  const handlePurgeTool = async (tool: ToolItem) => {
    setFeedback(null);

    try {
      const res = await invalidateToolCache.mutateAsync(tool.id);

      setFeedback({
        kind: "ok",
        message: `Purged ${res.deleted} cached entries for ${tool.slug}.`,
      });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to purge tool cache.",
      });
    }
  };

  const handlePurgeTag = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    const tag = purgeTag.trim();

    if (tag.length === 0) {
      return;
    }

    try {
      const res = await invalidateTagCache.mutateAsync(tag);

      setFeedback({
        kind: "ok",
        message: `Purged ${res.deleted} cached entries for tag '${tag}'.`,
      });
      setPurgeTag("");
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Failed to purge tag cache.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tools &amp; Redis Cache</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Normalized catalog across all MCP servers and code plugins with per-tool cache policies.
          </p>
        </div>
        <div className="w-64">
          <Input
            aria-label="Filter tools by slug or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter tools by slug or description..."
          />
        </div>
      </div>

      {queryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load tools: {queryError instanceof Error ? queryError.message : "Unknown error"}
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
            <CardTitle>Purge Cache by Tag</CardTitle>
            <CardDescription>
              Invalidate all Redis tool results associated with a shared tag.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form onSubmit={handlePurgeTag} className="flex max-w-md gap-2">
              <Input
                aria-label="Cache tag to purge"
                value={purgeTag}
                onChange={(event) => setPurgeTag(event.target.value)}
                placeholder="e.g. github:issues"
              />
              <Button type="submit" variant="secondary" disabled={invalidateTagCache.isPending}>
                <IconDatabaseOff size={15} stroke={1.75} />
                <span>Purge Tag</span>
              </Button>
            </Form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Canonical Tool Catalog ({filteredTools.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-xs text-muted-foreground">Loading tools...</p> : null}
          {!isLoading && !queryError && filteredTools.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tools discovered yet.</p>
          ) : null}
          {!isLoading && filteredTools.length > 0 ? (
            <div className="divide-y divide-border">
              {filteredTools.map((tool) => {
                const isEditing = selectedToolId === tool.id;

                return (
                  <div key={tool.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium text-foreground">
                            {tool.slug}
                          </span>
                          <Badge variant={tool.cachePolicy.mode === "off" ? "muted" : "success"}>
                            cache: {tool.cachePolicy.mode}
                            {tool.cachePolicy.mode !== "off"
                              ? ` (${tool.cachePolicy.ttlSeconds}s)`
                              : ""}
                          </Badge>
                          {tool.annotations.readOnlyHint ? (
                            <Badge variant="default">read-only</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {tool.description || "No description"}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          schema: {tool.schemaHash.slice(0, 12)}
                        </p>
                      </div>

                      {isAdmin ? (
                        <div className="flex items-center gap-2.5">
                          <Switch
                            aria-label={`Enable or disable ${tool.slug}`}
                            disabled={updateTool.isPending}
                            checked={tool.enabled}
                            onCheckedChange={(checked) => void handleToggleTool(tool, checked)}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              isEditing ? setSelectedToolId(null) : startEditing(tool)
                            }
                          >
                            {isEditing ? "Cancel" : "Cache Policy"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Purge cached entries for ${tool.slug}`}
                            disabled={invalidateToolCache.isPending}
                            onClick={() => void handlePurgeTool(tool)}
                          >
                            <IconDatabaseOff size={15} stroke={1.75} />
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <Form
                        onSubmit={handleSaveCachePolicy}
                        className="mt-4 grid gap-3 rounded-md border border-border bg-muted/40 p-4 md:grid-cols-5"
                      >
                        <Field label="Cache Mode">
                          <Select
                            value={cacheMode}
                            onChange={(event) => setCacheMode(event.target.value as ToolCacheMode)}
                          >
                            <option value="off">Off</option>
                            <option value="ttl">TTL</option>
                            <option value="stale_while_revalidate">Stale-While-Revalidate</option>
                          </Select>
                        </Field>
                        <Field label="TTL (seconds)">
                          <Input
                            type="number"
                            min={1}
                            max={86400}
                            value={ttlSeconds}
                            onChange={(event) => setTtlSeconds(event.target.value)}
                          />
                        </Field>
                        {cacheMode === "stale_while_revalidate" ? (
                          <Field label="Stale Window (seconds)">
                            <Input
                              type="number"
                              min={0}
                              max={86400}
                              value={staleSeconds}
                              onChange={(event) => setStaleSeconds(event.target.value)}
                            />
                          </Field>
                        ) : null}
                        <Field label="Tags (comma-separated)">
                          <Input
                            value={tagsInput}
                            onChange={(event) => setTagsInput(event.target.value)}
                            placeholder="github:issues"
                          />
                        </Field>
                        <div className="flex flex-col justify-between gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Allow bypass</span>
                            <Switch
                              aria-label="Allow cache bypass"
                              checked={allowBypass}
                              onCheckedChange={setAllowBypass}
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={updateTool.isPending}>
                            Save Policy
                          </Button>
                        </div>
                      </Form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
