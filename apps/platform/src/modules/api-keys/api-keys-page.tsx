import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Copy01Icon, Edit02Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useModelsQuery, type Model } from "../models/hooks";
import {
  isForbiddenError,
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
  useUpdateApiKeyModelAccessMutation,
  type ApiKey,
  type UpdateApiKeyModelAccessInput,
} from "./hooks";

type ModelAccessMode = "snapshot" | "filtered" | "future";

const modelAccessLabels: Record<ModelAccessMode, string> = {
  snapshot: "Current enabled models",
  filtered: "Selected models",
  future: "Current and future models",
};

export function ApiKeysPage() {
  const query = useApiKeysQuery();
  const create = useCreateApiKeyMutation();
  const revoke = useRevokeApiKeyMutation();
  const updateModelAccess = useUpdateApiKeyModelAccessMutation();
  const [revealed, setRevealed] = useState<{ id: string; key: string } | null>(null);
  const [name, setName] = useState("");
  const [spendLimitUsd, setSpendLimitUsd] = useState("");
  const [modelAccessMode, setModelAccessMode] = useState<ModelAccessMode>("snapshot");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [editModelAccessMode, setEditModelAccessMode] = useState<ModelAccessMode>("filtered");
  const [editSelectedModelIds, setEditSelectedModelIds] = useState<string[]>([]);
  const [editModelSearch, setEditModelSearch] = useState("");
  const modelsQuery = useModelsQuery({
    enabled:
      modelAccessMode === "filtered" || (Boolean(editingKey) && editModelAccessMode === "filtered"),
  });
  const models = modelsQuery.data?.data ?? [];
  const filteredModels = useMemo(
    () => models.filter((model) => matchesModelSearch(model, modelSearch)),
    [models, modelSearch],
  );
  const filteredEditModels = useMemo(
    () => models.filter((model) => matchesModelSearch(model, editModelSearch)),
    [models, editModelSearch],
  );

  function resetCreateForm() {
    setName("");
    setSpendLimitUsd("");
    setModelAccessMode("snapshot");
    setSelectedModelIds([]);
    setModelSearch("");
    create.reset();
  }

  function toggleCreateModel(modelId: string, checked: boolean) {
    setSelectedModelIds(toggleModelId(modelId, checked));
  }

  function toggleEditModel(modelId: string, checked: boolean) {
    setEditSelectedModelIds(toggleModelId(modelId, checked));
  }

  function openEditModelAccess(key: ApiKey) {
    setEditingKey(key);
    setEditModelAccessMode(key.includeFutureModels ? "future" : "filtered");
    setEditSelectedModelIds(key.allowedModelIds ?? []);
    setEditModelSearch("");
    updateModelAccess.reset();
  }

  function closeEditModelAccess() {
    setEditingKey(null);
    setEditModelAccessMode("filtered");
    setEditSelectedModelIds([]);
    setEditModelSearch("");
    updateModelAccess.reset();
  }

  function toggleModelId(modelId: string, checked: boolean) {
    return (current: string[]) => {
      if (checked) {
        return current.includes(modelId) ? current : [...current, modelId];
      }

      return current.filter((id) => id !== modelId);
    };
  }

  if (isForbiddenError(query.error)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin only</CardTitle>
          <CardDescription>API key management is restricted to administrators.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const keys = query.data?.keys ?? [];

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Create keys for internal services to call the gateway. Each key is shown once.
          </p>
        </div>
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setRevealed(null);
              resetCreateForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <HugeiconsIcon icon={Key01Icon} className="size-4" />
              New API key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            {revealed ? (
              <>
                <DialogHeader>
                  <DialogTitle>Save this key</DialogTitle>
                  <DialogDescription>
                    This is the only time the full key will be shown. Copy it now.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border bg-muted/30 p-3">
                  <code className="block break-all text-xs">{revealed.key}</code>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(revealed.key)}
                  >
                    <HugeiconsIcon icon={Copy01Icon} className="size-4" /> Copy
                  </Button>
                  <Button onClick={() => setRevealed(null)}>Done</Button>
                </DialogFooter>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!name.trim()) return;
                  const parsedSpendLimit = spendLimitUsd.trim()
                    ? Number(spendLimitUsd.trim())
                    : null;

                  if (
                    parsedSpendLimit !== null &&
                    (!Number.isFinite(parsedSpendLimit) || parsedSpendLimit <= 0)
                  ) {
                    return;
                  }

                  create.mutate(
                    {
                      name: name.trim(),
                      spendLimitUsd: parsedSpendLimit,
                      allowedModelIds: modelAccessMode === "filtered" ? selectedModelIds : null,
                      includeFutureModels: modelAccessMode === "future",
                    },
                    {
                      onSuccess: (data) => {
                        setRevealed({ id: data.id, key: data.key });
                        resetCreateForm();
                      },
                    },
                  );
                }}
              >
                <DialogHeader>
                  <DialogTitle>Create API key</DialogTitle>
                  <DialogDescription>
                    Give the key a memorable name — e.g. <code>billing-service</code>.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-2">
                  <Label htmlFor="key-name">Name</Label>
                  <Input
                    id="key-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. billing-service"
                    autoFocus
                    required
                  />
                  <Label htmlFor="key-spend-limit">USD balance</Label>
                  <Input
                    id="key-spend-limit"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={spendLimitUsd}
                    onChange={(event) => setSpendLimitUsd(event.target.value)}
                    placeholder="Unlimited"
                  />
                  <div className="grid gap-2">
                    <Label>Model access</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-between">
                          {modelAccessLabels[modelAccessMode]}
                          <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[var(--radix-dropdown-menu-trigger-width)]"
                      >
                        <DropdownMenuRadioGroup
                          value={modelAccessMode}
                          onValueChange={(value) => setModelAccessMode(value as ModelAccessMode)}
                        >
                          <DropdownMenuRadioItem value="snapshot">
                            Current enabled models
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="filtered">
                            Selected models
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="future">
                            Current and future models
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {modelAccessMode === "snapshot" ? (
                    <p className="text-sm text-muted-foreground">
                      The key will be limited to models enabled right now.
                    </p>
                  ) : null}
                  {modelAccessMode === "future" ? (
                    <p className="text-sm text-destructive">
                      This key will automatically gain access to providers and models added later.
                    </p>
                  ) : null}
                  {modelAccessMode === "filtered" ? (
                    <div className="grid gap-3 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="model-filter-search">Models</Label>
                        <span className="text-xs text-muted-foreground">
                          {selectedModelIds.length} selected
                        </span>
                      </div>
                      <Input
                        id="model-filter-search"
                        type="search"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Search models or providers..."
                      />
                      {modelsQuery.isLoading ? (
                        <p className="text-sm text-muted-foreground">Loading models...</p>
                      ) : !models.length ? (
                        <p className="text-sm text-muted-foreground">No models available.</p>
                      ) : (
                        <ScrollArea className="h-64 rounded-md border">
                          <div className="grid divide-y">
                            {filteredModels.length ? (
                              filteredModels.map((model, index) => {
                                const checkboxId = `api-key-model-${index}`;
                                const selected = selectedModelIds.includes(model.id);

                                return (
                                  <label
                                    key={model.id}
                                    htmlFor={checkboxId}
                                    className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                                  >
                                    <Checkbox
                                      id={checkboxId}
                                      checked={selected}
                                      onCheckedChange={(checked) =>
                                        toggleCreateModel(model.id, checked === true)
                                      }
                                      className="mt-0.5"
                                    />
                                    <span className="grid min-w-0 gap-1">
                                      <span className="truncate font-medium">{model.id}</span>
                                      <span className="truncate text-xs text-muted-foreground">
                                        {model.provider === "mux" ? "Mux" : model.provider}
                                        {model.name !== model.id ? ` · ${model.name}` : ""}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })
                            ) : (
                              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                                No models match your search.
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      )}
                      {selectedModelIds.length === 0 ? (
                        <p className="text-sm text-destructive">
                          Select at least one model to create a filtered key.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {create.error ? (
                    <p className="text-sm text-destructive">{create.error.message}</p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={
                      create.isPending ||
                      (modelAccessMode === "filtered" && selectedModelIds.length === 0)
                    }
                  >
                    {create.isPending ? "Creating..." : "Create key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={Boolean(editingKey)} onOpenChange={(open) => !open && closeEditModelAccess()}>
        <DialogContent className="sm:max-w-2xl">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!editingKey) return;

              const input = toModelAccessInput(editModelAccessMode, editSelectedModelIds);
              if (!input) return;

              updateModelAccess.mutate(
                { id: editingKey.id, ...input },
                {
                  onSuccess: closeEditModelAccess,
                },
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit model access</DialogTitle>
              <DialogDescription>{editingKey?.name ?? "API key"}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Model access</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">
                      {modelAccessLabels[editModelAccessMode]}
                      <HugeiconsIcon icon={ArrowDown01Icon} className="size-4 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-[var(--radix-dropdown-menu-trigger-width)]"
                  >
                    <DropdownMenuRadioGroup
                      value={editModelAccessMode}
                      onValueChange={(value) => setEditModelAccessMode(value as ModelAccessMode)}
                    >
                      <DropdownMenuRadioItem value="snapshot">
                        Current enabled models
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="filtered">
                        Selected models
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="future">
                        Current and future models
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {editModelAccessMode === "snapshot" ? (
                <p className="text-sm text-muted-foreground">
                  Saving will replace this key&apos;s model list with models enabled right now.
                </p>
              ) : null}
              {editModelAccessMode === "future" ? (
                <p className="text-sm text-destructive">
                  This key will automatically gain access to providers and models added later.
                </p>
              ) : null}
              {editModelAccessMode === "filtered" ? (
                <div className="grid gap-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="edit-model-filter-search">Models</Label>
                    <span className="text-xs text-muted-foreground">
                      {editSelectedModelIds.length} selected
                    </span>
                  </div>
                  <Input
                    id="edit-model-filter-search"
                    type="search"
                    value={editModelSearch}
                    onChange={(event) => setEditModelSearch(event.target.value)}
                    placeholder="Search models or providers..."
                  />
                  {modelsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading models...</p>
                  ) : !models.length ? (
                    <p className="text-sm text-muted-foreground">No models available.</p>
                  ) : (
                    <ScrollArea className="h-64 rounded-md border">
                      <div className="grid divide-y">
                        {filteredEditModels.length ? (
                          filteredEditModels.map((model, index) => {
                            const checkboxId = `edit-api-key-model-${index}`;
                            const selected = editSelectedModelIds.includes(model.id);

                            return (
                              <label
                                key={model.id}
                                htmlFor={checkboxId}
                                className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                              >
                                <Checkbox
                                  id={checkboxId}
                                  checked={selected}
                                  onCheckedChange={(checked) =>
                                    toggleEditModel(model.id, checked === true)
                                  }
                                  className="mt-0.5"
                                />
                                <span className="grid min-w-0 gap-1">
                                  <span className="truncate font-medium">{model.id}</span>
                                  <span className="truncate text-xs text-muted-foreground">
                                    {model.provider === "mux" ? "Mux" : model.provider}
                                    {model.name !== model.id ? ` · ${model.name}` : ""}
                                  </span>
                                </span>
                              </label>
                            );
                          })
                        ) : (
                          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                            No models match your search.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  )}
                  {editSelectedModelIds.length === 0 ? (
                    <p className="text-sm text-destructive">Select at least one model.</p>
                  ) : null}
                </div>
              ) : null}
              {updateModelAccess.error ? (
                <p className="text-sm text-destructive">{updateModelAccess.error.message}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEditModelAccess}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  updateModelAccess.isPending ||
                  (editModelAccessMode === "filtered" && editSelectedModelIds.length === 0)
                }
              >
                {updateModelAccess.isPending ? "Saving..." : "Save access"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="grid min-w-0 gap-3">
        <h2 className="text-sm font-medium">{keys.length} keys</h2>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet. Create one above.</p>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key: ApiKey) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      {key.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Revoked</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatBalance(key)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatModelAccess(key)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{key.creator.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!key.isActive || updateModelAccess.isPending}
                          onClick={() => openEditModelAccess(key)}
                        >
                          <HugeiconsIcon icon={Edit02Icon} className="size-4" />
                          Models
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!key.isActive || revoke.isPending}
                          onClick={() => revoke.mutate(key.id)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </div>
  );
}

function matchesModelSearch(model: Model, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    model.id,
    model.name,
    model.provider,
    model.type ?? "",
    model.fallbackTargets?.map((target) => target.publicModelId).join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function formatBalance(key: ApiKey) {
  if (key.spendLimitUsd === null) {
    return "Unlimited";
  }

  return `${formatUsd(key.spentUsd)} / ${formatUsd(key.spendLimitUsd)}`;
}

function formatModelAccess(key: ApiKey) {
  if (key.includeFutureModels && key.allowAllModels) {
    return "All current and future models";
  }

  return `${key.allowedModelIds?.length ?? 0} models`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function toModelAccessInput(
  mode: ModelAccessMode,
  selectedModelIds: string[],
): UpdateApiKeyModelAccessInput | null {
  if (mode === "future") {
    return { mode: "future" };
  }

  if (mode === "snapshot") {
    return { mode: "snapshot" };
  }

  return selectedModelIds.length > 0
    ? { mode: "selected", allowedModelIds: selectedModelIds }
    : null;
}
