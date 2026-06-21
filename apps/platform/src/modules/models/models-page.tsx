import { Badge } from "@repo/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { useModelsQuery } from "./hooks";

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

export function ModelsPage() {
  const query = useModelsQuery();
  const models = query.data?.data ?? [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Available models</h1>
        <p className="text-sm text-muted-foreground">
          Aggregated across every provider that has an API key configured.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !models.length ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12">
          <p className="text-sm font-medium">No providers configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Set <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>,{" "}
            <code>GOOGLE_API_KEY</code>, or <code>MISTRAL_API_KEY</code> in the gateway environment
            to enable models.
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
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
              {models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <code className="text-xs font-medium">{m.id}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">{m.provider}</TableCell>
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
