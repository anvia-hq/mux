import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import type { ModelPricingTier } from "../models/hooks";

export type PricingTierDraft = {
  clientId: string;
  inputTokenThreshold: string;
  inputPricePer1M: string;
  outputPricePer1M: string;
};

let pricingTierCounter = 0;

export function newPricingTierDraft(): PricingTierDraft {
  pricingTierCounter += 1;
  return {
    clientId: `pricing-tier-${pricingTierCounter}`,
    inputTokenThreshold: "200000",
    inputPricePer1M: "0",
    outputPricePer1M: "0",
  };
}

export function pricingTierDraftsFromModel(tiers: ModelPricingTier[] | undefined) {
  return (tiers ?? []).map((tier) => ({
    ...newPricingTierDraft(),
    inputTokenThreshold: String(tier.inputTokenThreshold),
    inputPricePer1M: String(tier.inputPricePer1M),
    outputPricePer1M: String(tier.outputPricePer1M),
  }));
}

export function parsePricingTierDrafts(
  drafts: PricingTierDraft[],
  contextWindow: number,
): ModelPricingTier[] | string {
  const thresholds = new Set<number>();
  const tiers: ModelPricingTier[] = [];

  for (const draft of drafts) {
    const inputTokenThreshold = Number(draft.inputTokenThreshold);
    const inputPricePer1M = Number(draft.inputPricePer1M);
    const outputPricePer1M = Number(draft.outputPricePer1M);
    if (!Number.isInteger(inputTokenThreshold) || inputTokenThreshold <= 0) {
      return "Pricing thresholds must be positive whole token counts.";
    }
    if (thresholds.has(inputTokenThreshold)) {
      return `Duplicate pricing threshold: ${inputTokenThreshold.toLocaleString()}.`;
    }
    if (contextWindow > 0 && inputTokenThreshold >= contextWindow) {
      return "Pricing thresholds must be below the model context window.";
    }
    if (
      !Number.isFinite(inputPricePer1M) ||
      !Number.isFinite(outputPricePer1M) ||
      inputPricePer1M < 0 ||
      outputPricePer1M < 0
    ) {
      return "Tier prices must be non-negative numbers.";
    }
    thresholds.add(inputTokenThreshold);
    tiers.push({ inputTokenThreshold, inputPricePer1M, outputPricePer1M });
  }

  return tiers.sort((left, right) => left.inputTokenThreshold - right.inputTokenThreshold);
}

export function PricingTierEditor({
  idPrefix,
  tiers,
  onChange,
}: {
  idPrefix: string;
  tiers: PricingTierDraft[];
  onChange: (tiers: PricingTierDraft[]) => void;
}) {
  function updateTier(index: number, patch: Partial<PricingTierDraft>) {
    onChange(tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...patch } : tier)));
  }

  return (
    <div className="grid gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Long-context pricing tiers</div>
          <div className="text-xs text-muted-foreground">
            The highest crossed threshold prices the entire request.
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...tiers, newPricingTierDraft()])}
        >
          Add tier
        </Button>
      </div>
      {tiers.length === 0 ? (
        <div className="text-xs text-muted-foreground">Base pricing applies at every length.</div>
      ) : null}
      {tiers.map((tier, index) => (
        <div
          key={tier.clientId}
          className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-${index}-threshold`}>Above input tokens</Label>
            <Input
              id={`${idPrefix}-${index}-threshold`}
              type="number"
              min={1}
              step={1}
              value={tier.inputTokenThreshold}
              onChange={(event) => updateTier(index, { inputTokenThreshold: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-${index}-input-price`}>Input $/1M</Label>
            <Input
              id={`${idPrefix}-${index}-input-price`}
              type="number"
              min={0}
              step="any"
              value={tier.inputPricePer1M}
              onChange={(event) => updateTier(index, { inputPricePer1M: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-${index}-output-price`}>Output $/1M</Label>
            <Input
              id={`${idPrefix}-${index}-output-price`}
              type="number"
              min={0}
              step="any"
              value={tier.outputPricePer1M}
              onChange={(event) => updateTier(index, { outputPricePer1M: event.target.value })}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(tiers.filter((_, tierIndex) => tierIndex !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
