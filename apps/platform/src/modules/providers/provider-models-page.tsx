import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
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
  PROVIDER_LABELS,
  type ProviderModel,
  type ProviderName,
  useProviderModelsQuery,
  useToggleModelMutation,
  useEnableAllMutation,
  useDisableAllMutation,
} from "./hooks";
import { ModelIdCopyButton } from "../models/model-id-copy-button";
import { ModalityIcons } from "../models/modality-icons";

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

function CapabilityBadge({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
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

function ProviderLogo({ provider }: { provider: ProviderName }) {
  return (
    <img
      src={`https://models.dev/logos/${provider}.svg`}
      alt={`${PROVIDER_LABELS[provider]} logo`}
      className="size-8 object-contain brightness-0 invert"
      loading="lazy"
    />
  );
}

const skeletonRows = ["model-a", "model-b", "model-c", "model-d", "model-e", "model-f"];

export function ProviderModelsPage({ provider }: { provider: ProviderName }) {
  const query = useProviderModelsQuery(provider);
  const toggle = useToggleModelMutation(provider);
  const enableAll = useEnableAllMutation(provider);
  const disableAll = useDisableAllMutation(provider);
  const models = query.data?.data ?? [];
  const [search, setSearch] = useState("");
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

  return (
    <div className="grid gap-6">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <ProviderLogo provider={provider} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{PROVIDER_LABELS[provider]} models</h1>
                <Badge variant="secondary" className="rounded-md">
                  {models.length} models
                </Badge>
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
        <Card className="items-center justify-center gap-1 p-10 text-center">
          <p className="text-sm font-medium">No models returned</p>
          <p className="max-w-lg text-sm text-muted-foreground">
            Check the saved {PROVIDER_LABELS[provider]} key and try refreshing the provider model
            list.
          </p>
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
                        {model.name === model.id ? PROVIDER_LABELS[provider] : model.name}
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
                        <Badge variant={model.enabled ? "default" : "secondary"}>
                          {model.enabled ? "On" : "Off"}
                        </Badge>
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
    </div>
  );
}
