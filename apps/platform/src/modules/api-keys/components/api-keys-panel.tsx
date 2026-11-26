import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { Select } from "@mux/ui/select";
import { IconCopy, IconTrash } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatRelativeTime } from "@/lib/format";
import { useEndpoints } from "@/modules/endpoints/hooks/use-endpoints";
import { useApiKeys } from "../hooks/use-api-keys";

export function ApiKeysPanel({ isAdmin }: { isAdmin: boolean }) {
  const { apiKeys, isLoading, createKey, revokeKey } = useApiKeys();
  const { endpoints } = useEndpoints(null);
  const [name, setName] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveEndpointId = isAdmin ? endpointId : endpointId || endpoints[0]?.id || "";
  const endpointNameById = new Map(endpoints.map((ep) => [ep.id, ep.slug]));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setRevealedKey(null);

    try {
      const scopedEndpointId = effectiveEndpointId.length > 0 ? effectiveEndpointId : null;

      if (!isAdmin && scopedEndpointId === null) {
        throw new Error("Members must bind API keys to a specific endpoint.");
      }

      const created = await createKey.mutateAsync({
        name: name.trim(),
        endpointId: scopedEndpointId,
      });

      setName("");
      setRevealedKey(created.rawKey);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to create API key.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Gateway API Keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue bearer tokens for AI agents connecting to{" "}
          <code className="font-mono">/mcp/:slug</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create API Key</CardTitle>
          <CardDescription>
            {isAdmin
              ? "Create global keys or keys scoped to a single virtual MCP endpoint."
              : "Members can issue keys scoped to an existing virtual endpoint."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-3">
            <Field label="Key Name">
              <Input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Cursor Local Agent"
              />
            </Field>
            <Field label="Endpoint Scope">
              <Select
                value={effectiveEndpointId}
                onChange={(event) => setEndpointId(event.target.value)}
              >
                {isAdmin ? <option value="">Global (all endpoints)</option> : null}
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    /mcp/{ep.slug}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={createKey.isPending} className="w-full">
                Issue Key
              </Button>
            </div>
          </Form>

          {errorMsg ? <p className="text-xs text-destructive">{errorMsg}</p> : null}

          {revealedKey ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-3.5">
              <p className="text-xs font-medium text-success">
                Copy this key now — it will not be shown again:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2.5 py-1.5 font-mono text-xs text-foreground">
                  {revealedKey}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(revealedKey)}
                >
                  <IconCopy size={14} stroke={1.75} />
                  <span>Copy</span>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issued Keys ({apiKeys.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-xs text-muted-foreground">Loading API keys...</p> : null}
          {!isLoading && apiKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">No API keys issued yet.</p>
          ) : null}
          {!isLoading && apiKeys.length > 0 ? (
            <div className="divide-y divide-border">
              {apiKeys.map((key) => {
                const scopeLabel = key.endpointId
                  ? `/mcp/${endpointNameById.get(key.endpointId) ?? key.endpointId}`
                  : "global";

                return (
                  <div
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{key.name}</span>
                        <code className="font-mono text-xs text-muted-foreground">
                          {key.keyPrefix}...
                        </code>
                        <Badge variant={key.revokedAt ? "destructive" : "success"}>
                          {key.revokedAt ? "revoked" : "active"}
                        </Badge>
                        <Badge variant="muted">{scopeLabel}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Last used: {formatRelativeTime(key.lastUsedAt)}
                      </p>
                    </div>
                    {!key.revokedAt ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={revokeKey.isPending}
                        onClick={() => revokeKey.mutate(key.id)}
                      >
                        <IconTrash size={14} stroke={1.75} />
                        <span>Revoke</span>
                      </Button>
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
