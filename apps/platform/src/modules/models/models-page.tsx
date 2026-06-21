import { useMemo, useState } from "react";
import { Badge } from "@repo/ui/components/badge";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { useModelsQuery, type Model } from "./hooks";

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatPrice(price: number) {
  if (price === 0) return "$0";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

function CapBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={enabled ? "text-emerald-500" : "text-muted-foreground/40"}>
      {enabled ? "Yes" : "-"}
    </span>
  );
}

function ProviderLogo({ provider }: { provider: string }) {
  return (
    <img
      src={`https://models.dev/logos/${provider}.svg`}
      alt={`${provider} logo`}
      className="size-5 object-contain brightness-0 invert"
      loading="lazy"
    />
  );
}

function matchesSearch(model: Model, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    model.id,
    model.name,
    model.provider,
    model.weights,
    model.inputModalities.join(" "),
    model.outputModalities.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function ModelsPage() {
  const query = useModelsQuery();
  const models = query.data?.data ?? [];
  const [search, setSearch] = useState("");
  const filteredModels = useMemo(
    () => models.filter((model) => matchesSearch(model, search)),
    [models, search],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Available models</h1>
          <p className="text-sm text-muted-foreground">
            Aggregated across every provider that has an API key configured.
          </p>
        </div>
        <div className="w-full lg:w-80">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search models or providers..."
          />
        </div>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !models.length ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12">
          <p className="text-sm font-medium">No providers configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Save a provider key from the Providers page to enable models.
          </p>
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Output</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead className="text-right">Max Out</TableHead>
                <TableHead className="text-right">In $/1M</TableHead>
                <TableHead className="text-right">Out $/1M</TableHead>
                <TableHead className="text-center">Reason</TableHead>
                <TableHead className="text-center">Tools</TableHead>
                <TableHead className="text-center">Struct</TableHead>
                <TableHead className="text-center">Weights</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.length ? (
                filteredModels.map((m) => (
                  <TableRow key={`${m.provider}:${m.id}`}>
                    <TableCell>
                      <code className="text-xs font-medium">{m.id}</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ProviderLogo provider={m.provider} />
                        <span className="capitalize">{m.provider}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {m.inputModalities.join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {m.outputModalities.join(", ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {m.contextWindow > 0 ? formatTokens(m.contextWindow) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {m.maxOutputTokens > 0 ? formatTokens(m.maxOutputTokens) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.inputPricePer1M > 0 ? formatPrice(m.inputPricePer1M) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.outputPricePer1M > 0 ? formatPrice(m.outputPricePer1M) : "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <CapBadge enabled={m.reasoning} />
                    </TableCell>
                    <TableCell className="text-center">
                      <CapBadge enabled={m.toolCall} />
                    </TableCell>
                    <TableCell className="text-center">
                      <CapBadge enabled={m.structuredOutput} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={m.weights === "open" ? "default" : "secondary"}>
                        {m.weights}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm text-muted-foreground">
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
