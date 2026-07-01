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
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";
import { Switch } from "@repo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import {
  type CustomProviderModelInput,
  type ProviderCatalogRow,
  providerLabel,
  useCreateCustomProviderMutation,
  useDeleteCustomProviderMutation,
  useDeleteProviderKeyMutation,
  useProviderCatalogQuery,
  useSetProviderKeyMutation,
} from "./hooks";

type ProviderFilter = "all" | "configured" | "needs-key" | "custom";

type ProviderEditor =
  | {
      mode: "key" | "remove-key" | "delete-custom";
      provider: ProviderCatalogRow;
    }
  | { mode: "custom-create" }
  | null;

type ModelDraft = {
  clientId: string;
  id: string;
  name: string;
  inputPricePer1M: string;
  outputPricePer1M: string;
  contextWindow: string;
  maxOutputTokens: string;
  inputModalities: string;
  outputModalities: string;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  weights: "open" | "closed";
};

type CustomProviderDraft = {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  models: ModelDraft[];
};

const filterOptions: Array<{ value: ProviderFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "configured", label: "Configured" },
  { value: "needs-key", label: "Needs key" },
  { value: "custom", label: "Custom" },
];

const skeletonRows = Array.from({ length: 8 }, (_, index) => `provider-skeleton-${index}`);

let modelDraftCounter = 0;

function nextModelDraftId() {
  modelDraftCounter += 1;
  return `custom-model-draft-${modelDraftCounter}`;
}

function newModelDraft(): ModelDraft {
  return {
    clientId: nextModelDraftId(),
    id: "",
    name: "",
    inputPricePer1M: "0",
    outputPricePer1M: "0",
    contextWindow: "128000",
    maxOutputTokens: "4096",
    inputModalities: "text",
    outputModalities: "text",
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  };
}

function newCustomProviderDraft(): CustomProviderDraft {
  return {
    id: "",
    name: "",
    apiBase: "",
    apiKey: "",
    models: [newModelDraft()],
  };
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseModalities(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseModelDrafts(drafts: ModelDraft[]): CustomProviderModelInput[] | string {
  const models: CustomProviderModelInput[] = [];
  const seen = new Set<string>();

  for (const draft of drafts) {
    const id = draft.id.trim();
    const name = draft.name.trim();
    if (!id || !name) return "Every model needs an id and name.";
    if (seen.has(id)) return `Duplicate model id: ${id}`;
    seen.add(id);

    const inputPricePer1M = Number(draft.inputPricePer1M);
    const outputPricePer1M = Number(draft.outputPricePer1M);
    const contextWindow = Number(draft.contextWindow);
    const maxOutputTokens = Number(draft.maxOutputTokens);
    const inputModalities = parseModalities(draft.inputModalities);
    const outputModalities = parseModalities(draft.outputModalities);

    if (
      !Number.isFinite(inputPricePer1M) ||
      !Number.isFinite(outputPricePer1M) ||
      inputPricePer1M < 0 ||
      outputPricePer1M < 0
    ) {
      return "Model prices must be non-negative numbers.";
    }

    if (
      !Number.isInteger(contextWindow) ||
      !Number.isInteger(maxOutputTokens) ||
      contextWindow < 0 ||
      maxOutputTokens < 0
    ) {
      return "Token limits must be non-negative whole numbers.";
    }

    if (!inputModalities.length || !outputModalities.length) {
      return "Each model needs at least one input and output modality.";
    }

    models.push({
      id,
      name,
      inputPricePer1M,
      outputPricePer1M,
      contextWindow,
      maxOutputTokens,
      inputModalities,
      outputModalities,
      reasoning: draft.reasoning,
      toolCall: draft.toolCall,
      structuredOutput: draft.structuredOutput,
      weights: draft.weights,
    });
  }

  return models;
}

export function ProvidersList() {
  const query = useProviderCatalogQuery();
  const setKey = useSetProviderKeyMutation();
  const deleteKey = useDeleteProviderKeyMutation();
  const createCustom = useCreateCustomProviderMutation();
  const deleteCustom = useDeleteCustomProviderMutation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [editor, setEditor] = useState<ProviderEditor>(null);
  const [apiKey, setApiKey] = useState("");
  const [customDraft, setCustomDraft] = useState<CustomProviderDraft>(() =>
    newCustomProviderDraft(),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const providers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (query.data?.providers ?? [])
      .filter((provider) => {
        if (filter === "configured" && !provider.configured) return false;
        if (filter === "needs-key" && provider.configured) return false;
        if (filter === "custom" && provider.type !== "custom") return false;
        if (!normalizedSearch) return true;

        const label = providerLabel(provider.provider, provider.name);
        return `${label} ${provider.provider} ${provider.apiBase ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((a, b) => {
        if (a.configured !== b.configured) return a.configured ? -1 : 1;
        if (a.type !== b.type) return a.type === "custom" ? -1 : 1;
        return providerLabel(a.provider, a.name).localeCompare(providerLabel(b.provider, b.name));
      });
  }, [filter, query.data?.providers, search]);

  const allProviders = query.data?.providers ?? [];
  const configuredCount = allProviders.filter((provider) => provider.configured).length;
  const needsKeyCount = allProviders.filter((provider) => !provider.configured).length;
  const customCount = allProviders.filter((provider) => provider.type === "custom").length;
  const busy =
    setKey.isPending || deleteKey.isPending || createCustom.isPending || deleteCustom.isPending;

  const closeEditor = () => {
    setEditor(null);
    setApiKey("");
    setCustomDraft(newCustomProviderDraft());
    setFormError(null);
    setKey.reset();
    deleteKey.reset();
    createCustom.reset();
    deleteCustom.reset();
  };

  const openEditor = (nextEditor: ProviderEditor) => {
    setApiKey("");
    setFormError(null);
    setKey.reset();
    deleteKey.reset();
    createCustom.reset();
    deleteCustom.reset();
    setEditor(nextEditor);
  };

  const onSaveKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editor?.mode !== "key" || apiKey.length < 8) return;

    await setKey.mutateAsync({ provider: editor.provider.provider, apiKey });
    closeEditor();
  };

  const onRemoveKey = async () => {
    if (editor?.mode !== "remove-key") return;
    await deleteKey.mutateAsync(editor.provider.provider);
    closeEditor();
  };

  const onDeleteCustom = async () => {
    if (editor?.mode !== "delete-custom") return;
    await deleteCustom.mutateAsync(editor.provider.provider);
    closeEditor();
  };

  const onCreateCustom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const id = customDraft.id.trim();
    const name = customDraft.name.trim();
    const apiBase = customDraft.apiBase.trim();
    if (!id || !name || !apiBase || customDraft.apiKey.length < 8) {
      setFormError("Provider id, name, URL, and API key are required.");
      return;
    }

    const models = parseModelDrafts(customDraft.models);
    if (typeof models === "string") {
      setFormError(models);
      return;
    }

    await createCustom.mutateAsync({
      id,
      name,
      apiBase,
      apiKey: customDraft.apiKey,
      models,
    });
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

        <div className="grid gap-2 sm:grid-cols-4 xl:w-[40rem]">
          <ProviderStat label="Configured" value={configuredCount} />
          <ProviderStat label="Needs key" value={needsKeyCount} />
          <ProviderStat label="Custom" value={customCount} />
          <ProviderStat label="Total" value={allProviders.length} />
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
                placeholder="Search provider name, id, or URL..."
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openEditor({ mode: "custom-create" })}
              >
                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                Custom
              </Button>
            </div>
          </div>

          <Table className="min-w-[66rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Saved key</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length ? (
                providers.map((provider) => (
                  <ProviderTableRow
                    key={provider.provider}
                    provider={provider}
                    busy={busy || (query.isFetching && !query.data)}
                    onEditKey={() => openEditor({ mode: "key", provider })}
                    onRemoveKey={() => openEditor({ mode: "remove-key", provider })}
                    onDeleteCustom={() => openEditor({ mode: "delete-custom", provider })}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-sm text-muted-foreground">
                    No providers match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className={editor?.mode === "custom-create" ? "sm:max-w-4xl" : undefined}>
          {editor?.mode === "custom-create" ? (
            <CustomProviderForm
              draft={customDraft}
              setDraft={setCustomDraft}
              error={formError ?? createCustom.error?.message ?? null}
              busy={busy}
              onCancel={closeEditor}
              onSubmit={onCreateCustom}
            />
          ) : editor?.mode === "delete-custom" ? (
            <DeleteCustomDialog
              provider={editor.provider}
              busy={busy}
              error={deleteCustom.error?.message ?? null}
              onCancel={closeEditor}
              onConfirm={onDeleteCustom}
            />
          ) : editor?.mode === "remove-key" ? (
            <RemoveKeyDialog
              provider={editor.provider}
              busy={busy}
              error={deleteKey.error?.message ?? null}
              onCancel={closeEditor}
              onConfirm={onRemoveKey}
            />
          ) : editor?.mode === "key" ? (
            <form onSubmit={onSaveKey}>
              <DialogHeader>
                <DialogTitle>
                  {editor.provider.configured ? "Replace" : "Add"}{" "}
                  {providerLabel(editor.provider.provider, editor.provider.name)} key
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
                {editor.provider.lastFour ? (
                  <p className="text-xs text-muted-foreground">
                    Current key ends in {editor.provider.lastFour}.
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
                  {setKey.isPending
                    ? "Saving..."
                    : editor.provider.configured
                      ? "Replace key"
                      : "Save key"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderLogo({ provider }: { provider: ProviderCatalogRow }) {
  const label = providerLabel(provider.provider, provider.name);
  if (provider.type !== "built-in") {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center">
        <span className="flex size-8 items-center justify-center rounded-md border bg-muted/40 text-xs font-semibold uppercase">
          {label.slice(0, 1)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex size-10 shrink-0 items-center justify-center">
      <img
        src={`https://models.dev/logos/${provider.provider}.svg`}
        alt={`${label} logo`}
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
  onEditKey,
  onRemoveKey,
  onDeleteCustom,
}: {
  provider: ProviderCatalogRow;
  busy?: boolean;
  onEditKey: () => void;
  onRemoveKey: () => void;
  onDeleteCustom: () => void;
}) {
  const label = providerLabel(provider.provider, provider.name);
  return (
    <TableRow>
      <TableCell className="min-w-60 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderLogo provider={provider} />
          <div className="min-w-0">
            <div className="truncate font-medium">{label}</div>
            <div className="truncate text-xs text-muted-foreground">{provider.provider}</div>
            {provider.apiBase ? (
              <div className="max-w-72 truncate text-xs text-muted-foreground">
                {provider.apiBase}
              </div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {provider.configured ? (
            <Badge className="rounded-md">Configured</Badge>
          ) : (
            <Badge variant="secondary" className="rounded-md">
              Needs key
            </Badge>
          )}
          {provider.type === "custom" ? (
            <Badge variant="outline" className="rounded-md">
              Custom
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {provider.lastFour ? `**** ${provider.lastFour}` : "-"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {provider.modelCount === null ? "-" : provider.modelCount}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {provider.updatedAt ? (
          <div className="grid gap-0.5">
            <span>{formatUpdatedAt(provider.updatedAt)}</span>
            <span className="max-w-52 truncate text-xs">
              {provider.updater?.email ?? "unknown"}
            </span>
          </div>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {provider.configured || provider.type === "custom" ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/providers/$name/models" params={{ name: provider.provider }}>
                <HugeiconsIcon icon={Settings01Icon} className="size-4" />
                Models
              </Link>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={onEditKey} disabled={busy}>
            <HugeiconsIcon icon={provider.configured ? Key01Icon : Add01Icon} className="size-4" />
            {provider.configured ? "Replace" : "Add key"}
          </Button>
          {provider.configured ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={`Remove ${label} key`}
              onClick={onRemoveKey}
              disabled={busy}
            >
              <HugeiconsIcon icon={Delete01Icon} className="size-4" />
            </Button>
          ) : null}
          {provider.type === "custom" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Delete ${label} provider`}
              onClick={onDeleteCustom}
              disabled={busy}
            >
              <HugeiconsIcon icon={Delete01Icon} className="size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CustomProviderForm({
  draft,
  setDraft,
  error,
  busy,
  onCancel,
  onSubmit,
}: {
  draft: CustomProviderDraft;
  setDraft: React.Dispatch<React.SetStateAction<CustomProviderDraft>>;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  function updateModel(index: number, next: Partial<ModelDraft>) {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, ...next } : model,
      ),
    }));
  }

  function addModel() {
    setDraft((current) => ({ ...current, models: [...current.models, newModelDraft()] }));
  }

  function removeModel(index: number) {
    setDraft((current) => ({
      ...current,
      models:
        current.models.length === 1
          ? [newModelDraft()]
          : current.models.filter((_, modelIndex) => modelIndex !== index),
    }));
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>New custom provider</DialogTitle>
        <DialogDescription>
          Add an OpenAI-compatible chat completions provider and the models it exposes.
        </DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[70dvh] gap-4 overflow-y-auto py-2 pr-1">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="custom-provider-id">Provider ID</Label>
            <Input
              id="custom-provider-id"
              value={draft.id}
              onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
              placeholder="internal-router"
              autoFocus
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="custom-provider-name">Display name</Label>
            <Input
              id="custom-provider-name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Internal Router"
              required
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="custom-provider-url">Chat completions base URL</Label>
            <Input
              id="custom-provider-url"
              value={draft.apiBase}
              onChange={(event) =>
                setDraft((current) => ({ ...current, apiBase: event.target.value }))
              }
              placeholder="https://api.example.com/v1"
              required
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="custom-provider-key">API key</Label>
            <Input
              id="custom-provider-key"
              type="password"
              value={draft.apiKey}
              onChange={(event) =>
                setDraft((current) => ({ ...current, apiKey: event.target.value }))
              }
              placeholder="Provider API key"
              autoComplete="off"
              required
            />
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Models</div>
              <div className="text-xs text-muted-foreground">{draft.models.length} defined</div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addModel}>
              <HugeiconsIcon icon={Add01Icon} className="size-4" />
              Add model
            </Button>
          </div>

          {draft.models.map((model, index) => (
            <div key={model.clientId} className="grid gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">Model {index + 1}</Badge>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove model"
                  onClick={() => removeModel(index)}
                >
                  <HugeiconsIcon icon={Delete01Icon} className="size-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ModelInput
                  id={`custom-model-${index}-id`}
                  label="Model ID"
                  value={model.id}
                  onChange={(value) => updateModel(index, { id: value })}
                  placeholder="llama-3.1-70b"
                />
                <ModelInput
                  id={`custom-model-${index}-name`}
                  label="Name"
                  value={model.name}
                  onChange={(value) => updateModel(index, { name: value })}
                  placeholder="Llama 3.1 70B"
                />
                <ModelInput
                  id={`custom-model-${index}-input-price`}
                  label="Input $/1M"
                  type="number"
                  value={model.inputPricePer1M}
                  onChange={(value) => updateModel(index, { inputPricePer1M: value })}
                />
                <ModelInput
                  id={`custom-model-${index}-output-price`}
                  label="Output $/1M"
                  type="number"
                  value={model.outputPricePer1M}
                  onChange={(value) => updateModel(index, { outputPricePer1M: value })}
                />
                <ModelInput
                  id={`custom-model-${index}-context`}
                  label="Context tokens"
                  type="number"
                  value={model.contextWindow}
                  onChange={(value) => updateModel(index, { contextWindow: value })}
                />
                <ModelInput
                  id={`custom-model-${index}-max-output`}
                  label="Max output tokens"
                  type="number"
                  value={model.maxOutputTokens}
                  onChange={(value) => updateModel(index, { maxOutputTokens: value })}
                />
                <ModelInput
                  id={`custom-model-${index}-input-modalities`}
                  label="Input modalities"
                  value={model.inputModalities}
                  onChange={(value) => updateModel(index, { inputModalities: value })}
                  placeholder="text,image"
                />
                <ModelInput
                  id={`custom-model-${index}-output-modalities`}
                  label="Output modalities"
                  value={model.outputModalities}
                  onChange={(value) => updateModel(index, { outputModalities: value })}
                  placeholder="text"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_10rem] md:items-center">
                <CapabilitySwitch
                  id={`custom-model-${index}-reasoning`}
                  label="Reasoning"
                  checked={model.reasoning}
                  onCheckedChange={(checked) => updateModel(index, { reasoning: checked })}
                />
                <CapabilitySwitch
                  id={`custom-model-${index}-tools`}
                  label="Tools"
                  checked={model.toolCall}
                  onCheckedChange={(checked) => updateModel(index, { toolCall: checked })}
                />
                <CapabilitySwitch
                  id={`custom-model-${index}-structured`}
                  label="Structured"
                  checked={model.structuredOutput}
                  onCheckedChange={(checked) => updateModel(index, { structuredOutput: checked })}
                />
                <div className="grid gap-2">
                  <Label htmlFor={`custom-model-${index}-weights`}>Weights</Label>
                  <NativeSelect
                    id={`custom-model-${index}-weights`}
                    value={model.weights}
                    onChange={(event) =>
                      updateModel(index, { weights: event.target.value as "open" | "closed" })
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="closed">closed</NativeSelectOption>
                    <NativeSelectOption value="open">open</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create provider"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ModelInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.0001" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function CapabilitySwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function RemoveKeyDialog({
  provider,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  provider: ProviderCatalogRow;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = providerLabel(provider.provider, provider.name);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove {label} key?</DialogTitle>
        <DialogDescription>
          The provider will stop contributing models to the gateway until a new key is saved.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        Saved key:{" "}
        <span className="font-medium tabular-nums">
          {provider.lastFour ? `ends in ${provider.lastFour}` : "unknown"}
        </span>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
          {busy ? "Removing..." : "Remove key"}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteCustomDialog({
  provider,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  provider: ProviderCatalogRow;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = providerLabel(provider.provider, provider.name);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete {label}?</DialogTitle>
        <DialogDescription>
          This removes the custom provider, its key, defined models, and fallback targets.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        Provider ID: <span className="font-mono text-xs">{provider.provider}</span>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
          {busy ? "Deleting..." : "Delete provider"}
        </Button>
      </DialogFooter>
    </>
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
