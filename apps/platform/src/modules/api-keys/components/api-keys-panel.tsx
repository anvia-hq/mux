import { Badge } from "@mux/ui/badge";
import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { Select } from "@mux/ui/select";
import { IconCheck, IconCopy, IconTrash } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatTimestamp } from "@/lib/format";
import { useEndpoints } from "@/modules/endpoints/hooks/use-endpoints";
import { useApiKeys } from "../hooks/use-api-keys";
import type { ApiKeyItem } from "../types";

const getKeyStatus = (
  key: ApiKeyItem,
): { label: string; variant: "destructive" | "warning" | "success" } => {
  if (key.revokedAt) {
    return { label: "revoked", variant: "destructive" };
  }

  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return { label: "expired", variant: "warning" };
  }

  return { label: "active", variant: "success" };
};

export function ApiKeysPanel({ isAdmin }: { isAdmin: boolean }) {
  const { apiKeys, isLoading, error: queryError, createKey, revokeKey } = useApiKeys();
  const { endpoints } = useEndpoints(null);
  const [name, setName] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedExists = endpoints.some((ep) => ep.id === endpointId);
  let effectiveEndpointId = "";

  if (selectedExists) {
    effectiveEndpointId = endpointId;
  } else if (!isAdmin) {
    effectiveEndpointId = endpoints[0]?.id ?? "";
  }

  const endpointNameById = new Map(endpoints.map((ep) => [ep.id, ep.slug]));
  const memberHasNoEndpoints = !isAdmin && endpoints.length === 0;

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setRevealedKey(null);
    setCopied(false);

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

  const handleCopy = async () => {
    if (!revealedKey) {
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable in this browser context.");
      }

      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to copy key to clipboard.");
    }
  };

  const handleRevoke = async (id: string) => {
    setErrorMsg(null);

    try {
      await revokeKey.mutateAsync(id);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to revoke API key.");
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

      {queryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          Failed to load API keys:{" "}
          {queryError instanceof Error ? queryError.message : "Unknown error"}
        </div>
      ) : null}

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
                disabled={memberHasNoEndpoints}
                value={effectiveEndpointId}
                onChange={(event) => setEndpointId(event.target.value)}
              >
                {isAdmin ? <option value="">Global (all endpoints)</option> : null}
                {memberHasNoEndpoints ? <option value="">No endpoints available yet</option> : null}
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    /mcp/{ep.slug}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={createKey.isPending || memberHasNoEndpoints}
                className="w-full"
              >
                Issue Key
              </Button>
            </div>
          </Form>

          {errorMsg ? <p className="text-xs text-destructive">{errorMsg}</p> : null}

          {revealedKey ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-success">
                  Copy this key now — it will not be shown again:
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRevealedKey(null);
                    setCopied(false);
                  }}
                >
                  Dismiss
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2.5 py-1.5 font-mono text-xs text-foreground">
                  {revealedKey}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <IconCheck size={14} stroke={1.75} />
                  ) : (
                    <IconCopy size={14} stroke={1.75} />
                  )}
                  <span>{copied ? "Copied" : "Copy"}</span>
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
          {!isLoading && !queryError && apiKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">No API keys issued yet.</p>
          ) : null}
          {!isLoading && apiKeys.length > 0 ? (
            <div className="divide-y divide-border">
              {apiKeys.map((key) => {
                const scopeLabel = key.endpointId
                  ? `/mcp/${endpointNameById.get(key.endpointId) ?? key.endpointId}`
                  : "global";
                const status = getKeyStatus(key);

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
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <Badge variant="muted">{scopeLabel}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Last used: {formatTimestamp(key.lastUsedAt)}
                      </p>
                    </div>
                    {!key.revokedAt ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={revokeKey.isPending}
                        onClick={() => void handleRevoke(key.id)}
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
