import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardDescription, CardTitle } from "@repo/ui/components/card";
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
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Providers</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Set the LLM provider keys the gateway can use. Keys are encrypted at rest and applied as
          soon as they are saved.
        </p>
      </div>

      {query.isLoading ? (
        <div className="grid gap-3">
          {PROVIDER_NAMES.map((name) => (
            <ProviderSkeleton key={name} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
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

function ProviderLogo({ name }: { name: ProviderName }) {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center">
      <img
        src={`https://models.dev/logos/${name}.svg`}
        alt={`${PROVIDER_LABELS[name]} logo`}
        className="size-8 object-contain brightness-0 invert"
        loading="lazy"
      />
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

  const busy = setKey.isPending || deleteKey.isPending;
  const savedAt = row ? new Date(row.updatedAt).toLocaleString() : null;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ProviderLogo name={name} />
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-semibold">
              {PROVIDER_LABELS[name]}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {configured ? `Key ends in ${row?.lastFour}` : "No key saved"}
            </CardDescription>
          </div>
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {configured ? (
              <Badge className="rounded-md">Configured</Badge>
            ) : (
              <Badge variant="secondary" className="rounded-md">
                Needs key
              </Badge>
            )}
            {configured ? (
              <span className="truncate text-xs text-muted-foreground">
                Updated {savedAt} by {row?.updater?.email ?? "unknown"}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Save a provider key to make its models available.
              </span>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Input
              type="password"
              placeholder={configured ? "Paste replacement key" : "Paste provider API key"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={disabled || busy}
            />
            <Button
              onClick={onSave}
              disabled={!value || value.length < 8 || setKey.isPending || deleteKey.isPending}
              className="sm:w-28"
            >
              {setKey.isPending ? "Saving..." : configured ? "Replace" : "Save key"}
            </Button>
            {configured ? (
              <div className="flex items-center gap-2">
                <Button asChild size="icon" variant="outline" aria-label="Manage models">
                  <Link
                    to="/providers/$name/models"
                    params={{ name }}
                    className="flex items-center justify-center"
                  >
                    <HugeiconsIcon icon={Settings01Icon} className="size-4 shrink-0" />
                  </Link>
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label={`Remove ${PROVIDER_LABELS[name]} key`}
                  onClick={onRemove}
                  disabled={deleteKey.isPending || setKey.isPending}
                >
                  <HugeiconsIcon icon={Delete01Icon} className="size-4 shrink-0" />
                </Button>
              </div>
            ) : null}
          </div>
          {(setKey.error || deleteKey.error) && (
            <p className="text-xs text-destructive">
              {(setKey.error || deleteKey.error)?.message ?? "Request failed"}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function ProviderSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)_auto] lg:items-center">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-md bg-secondary" />
          <div className="grid flex-1 gap-2">
            <div className="h-4 w-28 rounded-sm bg-secondary" />
            <div className="h-3 w-20 rounded-sm bg-secondary/70" />
          </div>
        </div>
        <div className="grid gap-3">
          <div className="h-4 w-48 rounded-sm bg-secondary" />
          <div className="h-9 rounded-md bg-secondary/70" />
        </div>
        <div className="h-8 w-20 rounded-md bg-secondary" />
      </div>
    </Card>
  );
}
