import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import {
  PROVIDER_LABELS,
  PROVIDER_NAMES,
  type ProviderName,
  useDeleteProviderKeyMutation,
  useProvidersQuery,
  useSetProviderKeyMutation,
} from "./hooks";

export function ProvidersList() {
  const query = useProvidersQuery();
  const configured = new Map((query.data?.providers ?? []).map((p) => [p.provider, p]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Providers</h1>
        <p className="text-sm text-muted-foreground">
          Set the LLM provider API keys the gateway should use. Keys are encrypted at rest and applied immediately, no restart required.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {PROVIDER_NAMES.map((name) => (
            <ProviderCard
              key={name}
              name={name}
              row={configured.get(name)}
              disabled={query.isFetching && !query.data}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  name,
  row,
  disabled,
}: {
  name: ProviderName;
  row?: { lastFour: string; updatedAt: string; updater?: { email: string } };
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const setKey = useSetProviderKeyMutation();
  const deleteKey = useDeleteProviderKeyMutation();

  const configured = Boolean(row);

  const onSave = async () => {
    if (!value || value.length < 8) return;
    await setKey.mutateAsync({ provider: name, apiKey: value });
    setValue("");
  };

  const onRemove = async () => {
    await deleteKey.mutateAsync(name);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{PROVIDER_LABELS[name]}</span>
          {configured ? (
            <Badge>Configured &middot; &hellip;{row?.lastFour}</Badge>
          ) : (
            <Badge variant="secondary">Not configured</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          {configured
            ? `Last updated by ${row?.updater?.email ?? "unknown"} on ${new Date(row!.updatedAt).toLocaleString()}`
            : "Paste an API key to enable this provider."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Input
          type="password"
          placeholder={configured ? "Replace key" : "sk-..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || setKey.isPending}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={onSave} disabled={!value || value.length < 8 || setKey.isPending}>
            {setKey.isPending ? "Saving..." : configured ? "Replace key" : "Save key"}
          </Button>
          {configured ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRemove}
              disabled={deleteKey.isPending}
            >
              {deleteKey.isPending ? "Removing..." : "Remove"}
            </Button>
          ) : null}
        </div>
        {configured ? (
          <Link
            to="/providers/$name/models"
            params={{ name }}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Manage models
          </Link>
        ) : null}
        {(setKey.error || deleteKey.error) && (
          <p className="text-xs text-red-500">
            {(setKey.error || deleteKey.error)?.message ?? "Request failed"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
