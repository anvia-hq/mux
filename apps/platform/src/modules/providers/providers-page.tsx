import { type FormEvent, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete01Icon,
  Key01Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import {
  PROVIDER_LABELS,
  PROVIDER_NAMES,
  type ProviderName,
  type ProviderRow,
  useDeleteProviderKeyMutation,
  useProvidersQuery,
  useSetProviderKeyMutation,
} from "./hooks";

type ProviderFilter = "all" | "configured" | "needs-key";

type ProviderEditor = {
  mode: "key" | "remove";
  provider: ProviderName;
} | null;

type ProviderItem = {
  name: ProviderName;
  label: string;
  row?: ProviderRow;
  configured: boolean;
};

const filterOptions: Array<{ value: ProviderFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "configured", label: "Configured" },
  { value: "needs-key", label: "Needs key" },
];

const skeletonRows = Array.from({ length: 8 }, (_, index) => `provider-skeleton-${index}`);

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ProvidersList() {
  const query = useProvidersQuery();
  const setKey = useSetProviderKeyMutation();
  const deleteKey = useDeleteProviderKeyMutation();
  const configured = useMemo(
    () => new Map((query.data?.providers ?? []).map((p) => [p.provider, p])),
    [query.data?.providers],
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [editor, setEditor] = useState<ProviderEditor>(null);
  const [apiKey, setApiKey] = useState("");

  const providers = useMemo<ProviderItem[]>(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return PROVIDER_NAMES.map((name) => ({
      name,
      label: PROVIDER_LABELS[name],
      row: configured.get(name),
      configured: configured.has(name),
    }))
      .filter((provider) => {
        if (filter === "configured" && !provider.configured) return false;
        if (filter === "needs-key" && provider.configured) return false;
        if (!normalizedSearch) return true;

        return `${provider.label} ${provider.name}`.toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => {
        if (a.configured !== b.configured) return a.configured ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [configured, filter, search]);

  const configuredCount = configured.size;
  const needsKeyCount = PROVIDER_NAMES.length - configuredCount;
  const selectedProvider = editor ? PROVIDER_LABELS[editor.provider] : "";
  const selectedRow = editor ? configured.get(editor.provider) : undefined;
  const busy = setKey.isPending || deleteKey.isPending;

  const closeEditor = () => {
    setEditor(null);
    setApiKey("");
    setKey.reset();
    deleteKey.reset();
  };

  const openEditor = (nextEditor: ProviderEditor) => {
    setApiKey("");
    setKey.reset();
    deleteKey.reset();
    setEditor(nextEditor);
  };

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editor?.mode !== "key" || apiKey.length < 8) return;

    await setKey.mutateAsync({ provider: editor.provider, apiKey });
    closeEditor();
  };

  const onRemove = async () => {
    if (editor?.mode !== "remove") return;

    await deleteKey.mutateAsync(editor.provider);
    closeEditor();
  };

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Providers</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Set the LLM provider keys the gateway can use. Keys are encrypted at rest and applied as
            soon as they are saved.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 xl:w-[30rem]">
          <ProviderStat label="Configured" value={configuredCount} />
          <ProviderStat label="Needs key" value={needsKeyCount} />
          <ProviderStat label="Total" value={PROVIDER_NAMES.length} />
        </div>
      </div>

      {query.isLoading ? (
        <ProviderTableSkeleton />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search provider name or id..."
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={filter === option.value ? "default" : "outline"}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <Table className="min-w-[58rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Saved key</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length ? (
                providers.map((provider) => (
                  <ProviderTableRow
                    key={provider.name}
                    provider={provider}
                    busy={busy || (query.isFetching && !query.data)}
                    onEdit={() => openEditor({ mode: "key", provider: provider.name })}
                    onRemove={() => openEditor({ mode: "remove", provider: provider.name })}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-sm text-muted-foreground">
                    No providers match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          {editor?.mode === "remove" ? (
            <>
              <DialogHeader>
                <DialogTitle>Remove {selectedProvider} key?</DialogTitle>
                <DialogDescription>
                  The provider will stop contributing models to the gateway until a new key is
                  saved.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                Saved key:{" "}
                <span className="font-medium tabular-nums">
                  {selectedRow?.lastFour ? `ends in ${selectedRow.lastFour}` : "unknown"}
                </span>
              </div>
              {deleteKey.error ? (
                <p className="text-sm text-destructive">{deleteKey.error.message}</p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeEditor} disabled={busy}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={onRemove} disabled={busy}>
                  {deleteKey.isPending ? "Removing..." : "Remove key"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={onSave}>
              <DialogHeader>
                <DialogTitle>
                  {selectedRow ? "Replace" : "Add"} {selectedProvider} key
                </DialogTitle>
                <DialogDescription>
                  Paste the provider API key. It will be encrypted at rest after saving.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 py-2">
                <Label htmlFor="provider-api-key">API key</Label>
                <Input
                  id="provider-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste provider API key"
                  autoComplete="off"
                  autoFocus
                  required
                />
                {selectedRow ? (
                  <p className="text-xs text-muted-foreground">
                    Current key ends in {selectedRow.lastFour}.
                  </p>
                ) : null}
                {setKey.error ? (
                  <p className="text-sm text-destructive">{setKey.error.message}</p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeEditor} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={apiKey.length < 8 || busy}>
                  {setKey.isPending ? "Saving..." : selectedRow ? "Replace key" : "Save key"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
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

function ProviderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-[0_0_0_2px_color-mix(in_oklab,var(--sidebar-border)_68%,black)]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ProviderTableRow({
  provider,
  busy,
  onEdit,
  onRemove,
}: {
  provider: ProviderItem;
  busy?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="min-w-60 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderLogo name={provider.name} />
          <div className="min-w-0">
            <div className="truncate font-medium">{provider.label}</div>
            <div className="truncate text-xs text-muted-foreground">{provider.name}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {provider.configured ? (
          <Badge className="rounded-md">Configured</Badge>
        ) : (
          <Badge variant="secondary" className="rounded-md">
            Needs key
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {provider.row?.lastFour ? `**** ${provider.row.lastFour}` : "-"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {provider.row ? (
          <div className="grid gap-0.5">
            <span>{formatUpdatedAt(provider.row.updatedAt)}</span>
            <span className="max-w-52 truncate text-xs">
              {provider.row.updater?.email ?? "unknown"}
            </span>
          </div>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {provider.configured ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/providers/$name/models" params={{ name: provider.name }}>
                <HugeiconsIcon icon={Settings01Icon} className="size-4" />
                Models
              </Link>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <HugeiconsIcon icon={provider.configured ? Key01Icon : Add01Icon} className="size-4" />
            {provider.configured ? "Replace" : "Add key"}
          </Button>
          {provider.configured ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={`Remove ${provider.label} key`}
              onClick={onRemove}
              disabled={busy}
            >
              <HugeiconsIcon icon={Delete01Icon} className="size-4" />
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ProviderTableSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="h-9 rounded-md bg-secondary" />
        <div className="flex gap-2">
          <div className="h-8 w-16 rounded-md bg-secondary/70" />
          <div className="h-8 w-28 rounded-md bg-secondary/70" />
          <div className="h-8 w-24 rounded-md bg-secondary/70" />
        </div>
      </div>
      <div className="grid gap-2 p-4">
        {skeletonRows.map((row) => (
          <div key={row} className="h-14 rounded-md bg-secondary/60" />
        ))}
      </div>
    </Card>
  );
}
