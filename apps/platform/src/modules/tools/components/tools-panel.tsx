import type { ToolCacheMode } from "@mux/core/types";
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
  const { tools, isLoading, updateTool, invalidateToolCache, invalidateTagCache } = useTools();
  const [search, setSearch] = useState("");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [cacheMode, setCacheMode] = useState<ToolCacheMode>("off");
  const [ttlSeconds, setTtlSeconds] = useState("60");
  const [tagsInput, setTagsInput] = useState("");
  const [purgeTag, setPurgeTag] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
    setTagsInput((tool.cachePolicy.tags ?? []).join(", "));
    setNotice(null);
  };

  const handleSaveCachePolicy = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedToolId) {
      return;
    }

    const parsedTtl = Math.max(1, Number.parseInt(ttlSeconds, 10) || 60);
    const tags = parseCommaTags(tagsInput);

    await updateTool.mutateAsync({
      id: selectedToolId,
      cachePolicy: {
        mode: cacheMode,
        ttlSeconds: parsedTtl,
        allowBypass: true,
        tags: tags.length > 0 ? tags : undefined,
      },
    });
    setNotice("Updated Redis cache policy and invalidated stale entries.");
    setSelectedToolId(null);
  };

  const handlePurgeTag = async (event: FormEvent) => {
    event.preventDefault();

    if (purgeTag.trim().length === 0) {
      return;
    }

    const res = await invalidateTagCache.mutateAsync(purgeTag.trim());

    setNotice(`Purged ${res.deleted} cached entries for tag '${purgeTag.trim()}'.`);
    setPurgeTag("");
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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter tools by slug or description..."
          />
        </div>
      </div>

      {notice ? (
        <div className="rounded-md border border-success/30 bg-success/10 px-3.5 py-2.5 text-xs text-success">
          {notice}
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
          {!isLoading && filteredTools.length === 0 ? (
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
                            checked={tool.enabled}
                            onCheckedChange={(checked) =>
                              updateTool.mutate({ id: tool.id, enabled: checked })
                            }
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
                            disabled={invalidateToolCache.isPending}
                            onClick={async () => {
                              const res = await invalidateToolCache.mutateAsync(tool.id);

                              setNotice(`Purged ${res.deleted} cached entries for ${tool.slug}.`);
                            }}
                          >
                            <IconDatabaseOff size={15} stroke={1.75} />
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <Form
                        onSubmit={handleSaveCachePolicy}
                        className="mt-4 grid gap-3 rounded-md border border-border bg-muted/40 p-4 md:grid-cols-4"
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
                        <Field label="Tags (comma-separated)">
                          <Input
                            value={tagsInput}
                            onChange={(event) => setTagsInput(event.target.value)}
                            placeholder="github:issues"
                          />
                        </Field>
                        <div className="flex items-end">
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
