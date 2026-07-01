import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
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
  type ProviderModel,
  providerLabel,
  useDisableAllMutation,
  useEnableAllMutation,
  useProviderCatalogQuery,
  useProviderModelsQuery,
  useReplaceCustomProviderModelsMutation,
  useToggleModelMutation,
} from "./hooks";
import { ModelIdCopyButton } from "../models/model-id-copy-button";
import { ModalityIcons } from "../models/modality-icons";

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

let draftCounter = 0;

function nextDraftId() {
  draftCounter += 1;
  return `model-draft-${draftCounter}`;
}

function formatTokens(n: number) {
  if (!n) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatPrice(price: number) {
  if (price === 0) return "$0";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

function matchesSearch(model: ProviderModel, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    model.id,
    model.name,
    model.weights,
    model.inputModalities.join(" "),
    model.outputModalities.join(" "),
    model.reasoning ? "reasoning" : "",
    model.toolCall ? "tools tool calling" : "",
    model.structuredOutput ? "structured output json" : "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function StatBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-border/70 border-t px-4 py-3 md:border-t-0 md:border-l">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-muted-foreground text-xs">{detail}</div>
    </div>
  );
}

function CapabilityBadge({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={
        enabled
          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
          : "border-border/60 bg-transparent text-muted-foreground/55"
      }
    >
      {children}
    </Badge>
  );
}

function ProviderLogo({ provider, custom }: { provider: string; custom: boolean }) {
  if (custom) {
    return (
      <span className="flex size-8 items-center justify-center rounded-md border bg-muted/40 text-xs font-semibold uppercase">
        {provider.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={`https://models.dev/logos/${provider}.svg`}
      alt={`${providerLabel(provider)} logo`}
      className="size-8 object-contain brightness-0 invert"
      loading="lazy"
    />
  );
}

function emptyModelDraft(): ModelDraft {
  return {
    clientId: nextDraftId(),
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

function draftFromModel(model: ProviderModel): ModelDraft {
  return {
    clientId: nextDraftId(),
    id: model.id,
    name: model.name,
    inputPricePer1M: String(model.inputPricePer1M),
    outputPricePer1M: String(model.outputPricePer1M),
    contextWindow: String(model.contextWindow),
    maxOutputTokens: String(model.maxOutputTokens),
    inputModalities: model.inputModalities.join(","),
    outputModalities: model.outputModalities.join(","),
    reasoning: model.reasoning,
    toolCall: model.toolCall,
    structuredOutput: model.structuredOutput,
    weights: model.weights,
  };
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
  const seen = new Set<string>();
  const models: CustomProviderModelInput[] = [];

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

const skeletonRows = ["model-a", "model-b", "model-c", "model-d", "model-e", "model-f"];

export function ProviderModelsPage({ provider }: { provider: string }) {
  const catalogQuery = useProviderCatalogQuery();
  const providerInfo = catalogQuery.data?.providers.find((row) => row.provider === provider);
  const isCustom = providerInfo?.type === "custom";
  const label = providerLabel(provider, providerInfo?.name);
  const query = useProviderModelsQuery(provider);
  const toggle = useToggleModelMutation(provider);
  const enableAll = useEnableAllMutation(provider);
  const disableAll = useDisableAllMutation(provider);
  const replaceModels = useReplaceCustomProviderModelsMutation(provider);
  const models = query.data?.data ?? [];
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [drafts, setDrafts] = useState<ModelDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const filteredModels = useMemo(
    () => models.filter((model) => matchesSearch(model, search)),
    [models, search],
  );
  const enabledCount = models.filter((model) => model.enabled).length;
  const maxContext = models.reduce((max, model) => Math.max(max, model.contextWindow), 0);
  const maxOutput = models.reduce((max, model) => Math.max(max, model.maxOutputTokens), 0);
  const lowestInputPrice = models.reduce<number | null>(
    (min, model) => (min === null ? model.inputPricePer1M : Math.min(min, model.inputPricePer1M)),
    null,
  );
  const capabilityCount = models.filter(
    (model) => model.reasoning || model.toolCall || model.structuredOutput,
  ).length;

  function openEditor() {
    setDrafts(models.length ? models.map(draftFromModel) : [emptyModelDraft()]);
    setFormError(null);
    replaceModels.reset();
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setDrafts([]);
    setFormError(null);
    replaceModels.reset();
  }

  async function submitModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = parseModelDrafts(drafts);
    if (typeof parsed === "string") {
      setFormError(parsed);
      return;
    }

    await replaceModels.mutateAsync(parsed);
    closeEditor();
  }

  return (
    <div className="grid gap-6">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <ProviderLogo provider={provider} custom={Boolean(isCustom)} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{label} models</h1>
                <Badge variant="secondary" className="rounded-md">
                  {models.length} models
                </Badge>
                {isCustom ? (
                  <Badge variant="outline" className="rounded-md">
                    Custom
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                <Link
                  to="/providers"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Providers
                </Link>{" "}
                &rarr; choose which models are exposed by the gateway and compare token limits,
                modalities, capabilities, and price per 1M tokens.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {isCustom ? (
              <Button size="sm" variant="outline" onClick={openEditor}>
                <HugeiconsIcon icon={Add01Icon} className="size-4" />
                Edit models
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => enableAll.mutate()}
              disabled={enableAll.isPending || disableAll.isPending}
            >
              {enableAll.isPending ? "Enabling..." : "Enable all"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => disableAll.mutate()}
              disabled={enableAll.isPending || disableAll.isPending}
            >
              {disableAll.isPending ? "Disabling..." : "Disable all"}
            </Button>
          </div>
        </div>

        <div className="grid bg-muted/20 md:grid-cols-4">
          <StatBlock
            label="Enabled"
            value={`${enabledCount}/${models.length}`}
            detail="visible in public model list"
          />
          <StatBlock label="Max context" value={formatTokens(maxContext)} detail="largest window" />
          <StatBlock label="Max output" value={formatTokens(maxOutput)} detail="generation cap" />
          <StatBlock
            label="Lowest input"
            value={lowestInputPrice === null ? "-" : `${formatPrice(lowestInputPrice)}/1M`}
            detail={`${capabilityCount} capability-rich models`}
          />
        </div>
      </Card>

      {query.isLoading ? (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-b p-4">
            <div className="h-9 w-full max-w-sm rounded-md bg-secondary" />
          </div>
          <div className="grid gap-3 p-4">
            {skeletonRows.map((row) => (
              <div key={row} className="h-14 rounded-md bg-secondary/60" />
            ))}
          </div>
        </Card>
      ) : !models.length ? (
        <Card className="items-center justify-center gap-3 p-10 text-center">
          <div>
            <p className="text-sm font-medium">No models returned</p>
            <p className="max-w-lg text-sm text-muted-foreground">
              Check the saved {label} key and try refreshing the provider model list.
            </p>
          </div>
          {isCustom ? (
            <Button size="sm" variant="outline" onClick={openEditor}>
              Edit models
            </Button>
          ) : null}
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium">Model catalog</div>
              <div className="text-muted-foreground text-sm">
                Showing {filteredModels.length} of {models.length} models
              </div>
            </div>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search model, modality, capability..."
              className="md:w-80"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Token limits</TableHead>
                <TableHead>Pricing</TableHead>
                <TableHead>Modalities</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="text-center">Weights</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.length ? (
                filteredModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="min-w-72 whitespace-normal py-3">
                      <ModelIdCopyButton modelId={model.id} />
                      <div className="mt-1 text-muted-foreground text-xs">
                        {model.name === model.id ? label : model.name}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-40 py-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted-foreground">Context</span>
                        <span className="text-right font-medium tabular-nums">
                          {formatTokens(model.contextWindow)}
                        </span>
                        <span className="text-muted-foreground">Output</span>
                        <span className="text-right font-medium tabular-nums">
                          {formatTokens(model.maxOutputTokens)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-40 py-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted-foreground">Input</span>
                        <span className="text-right font-medium tabular-nums">
                          {formatPrice(model.inputPricePer1M)}
                        </span>
                        <span className="text-muted-foreground">Output</span>
                        <span className="text-right font-medium tabular-nums">
                          {formatPrice(model.outputPricePer1M)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-44 whitespace-normal py-3">
                      <div className="grid gap-2 text-xs">
                        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2">
                          <span className="text-muted-foreground">In</span>
                          <ModalityIcons modalities={model.inputModalities} />
                        </div>
                        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2">
                          <span className="text-muted-foreground">Out</span>
                          <ModalityIcons modalities={model.outputModalities} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-56 whitespace-normal py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <CapabilityBadge enabled={model.reasoning}>Reasoning</CapabilityBadge>
                        <CapabilityBadge enabled={model.toolCall}>Tools</CapabilityBadge>
                        <CapabilityBadge enabled={model.structuredOutput}>
                          Structured
                        </CapabilityBadge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={model.weights === "open" ? "default" : "secondary"}>
                        {model.weights}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Switch
                          checked={model.enabled}
                          onCheckedChange={(checked) =>
                            toggle.mutate({ modelId: model.id, enabled: checked })
                          }
                          disabled={toggle.isPending}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                    No models match your search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editorOpen} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-4xl">
          <form onSubmit={submitModels}>
            <DialogHeader>
              <DialogTitle>Edit custom models</DialogTitle>
              <DialogDescription>{label}</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[70dvh] gap-3 overflow-y-auto py-2 pr-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">{drafts.length} models</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDrafts((current) => [...current, emptyModelDraft()])}
                >
                  <HugeiconsIcon icon={Add01Icon} className="size-4" />
                  Add model
                </Button>
              </div>

              {drafts.map((draft, index) => (
                <ModelDraftEditor
                  key={draft.clientId}
                  draft={draft}
                  index={index}
                  onChange={(next) =>
                    setDrafts((current) =>
                      current.map((item) =>
                        item.clientId === draft.clientId ? { ...item, ...next } : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    setDrafts((current) =>
                      current.length === 1
                        ? [emptyModelDraft()]
                        : current.filter((item) => item.clientId !== draft.clientId),
                    )
                  }
                />
              ))}

              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              {replaceModels.error ? (
                <p className="text-sm text-destructive">{replaceModels.error.message}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeEditor}
                disabled={replaceModels.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={replaceModels.isPending}>
                {replaceModels.isPending ? "Saving..." : "Save models"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelDraftEditor({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: ModelDraft;
  index: number;
  onChange: (next: Partial<ModelDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">Model {index + 1}</Badge>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Remove model"
          onClick={onRemove}
        >
          <HugeiconsIcon icon={Delete01Icon} className="size-4" />
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ModelInput
          id={`${draft.clientId}-id`}
          label="Model ID"
          value={draft.id}
          onChange={(value) => onChange({ id: value })}
        />
        <ModelInput
          id={`${draft.clientId}-name`}
          label="Name"
          value={draft.name}
          onChange={(value) => onChange({ name: value })}
        />
        <ModelInput
          id={`${draft.clientId}-input-price`}
          label="Input $/1M"
          type="number"
          value={draft.inputPricePer1M}
          onChange={(value) => onChange({ inputPricePer1M: value })}
        />
        <ModelInput
          id={`${draft.clientId}-output-price`}
          label="Output $/1M"
          type="number"
          value={draft.outputPricePer1M}
          onChange={(value) => onChange({ outputPricePer1M: value })}
        />
        <ModelInput
          id={`${draft.clientId}-context`}
          label="Context tokens"
          type="number"
          value={draft.contextWindow}
          onChange={(value) => onChange({ contextWindow: value })}
        />
        <ModelInput
          id={`${draft.clientId}-max-output`}
          label="Max output tokens"
          type="number"
          value={draft.maxOutputTokens}
          onChange={(value) => onChange({ maxOutputTokens: value })}
        />
        <ModelInput
          id={`${draft.clientId}-input-modalities`}
          label="Input modalities"
          value={draft.inputModalities}
          onChange={(value) => onChange({ inputModalities: value })}
        />
        <ModelInput
          id={`${draft.clientId}-output-modalities`}
          label="Output modalities"
          value={draft.outputModalities}
          onChange={(value) => onChange({ outputModalities: value })}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_10rem] md:items-center">
        <CapabilitySwitch
          id={`${draft.clientId}-reasoning`}
          label="Reasoning"
          checked={draft.reasoning}
          onCheckedChange={(checked) => onChange({ reasoning: checked })}
        />
        <CapabilitySwitch
          id={`${draft.clientId}-tools`}
          label="Tools"
          checked={draft.toolCall}
          onCheckedChange={(checked) => onChange({ toolCall: checked })}
        />
        <CapabilitySwitch
          id={`${draft.clientId}-structured`}
          label="Structured"
          checked={draft.structuredOutput}
          onCheckedChange={(checked) => onChange({ structuredOutput: checked })}
        />
        <div className="grid gap-2">
          <Label htmlFor={`${draft.clientId}-weights`}>Weights</Label>
          <NativeSelect
            id={`${draft.clientId}-weights`}
            value={draft.weights}
            onChange={(event) => onChange({ weights: event.target.value as "open" | "closed" })}
            className="w-full"
          >
            <NativeSelectOption value="closed">closed</NativeSelectOption>
            <NativeSelectOption value="open">open</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
    </div>
  );
}

function ModelInput({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
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
