import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import type { Model } from "./hooks";

function formatRate(rate: number) {
  return rate < 0.01 ? `$${rate.toFixed(4)}` : `$${rate.toFixed(2)}`;
}

export function PricingTierTooltip({ model, children }: { model: Model; children: ReactNode }) {
  if (!model.pricingTiers?.length) return children;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="cursor-help text-inherit underline decoration-dotted underline-offset-4">
          {children}
        </TooltipTrigger>
        <TooltipContent className="grid gap-1.5 text-xs">
          <span className="font-medium">Whole-request pricing tiers</span>
          <span>
            Base: {formatRate(model.inputPricePer1M)}/M input · {formatRate(model.outputPricePer1M)}
            /M output
          </span>
          {model.pricingTiers.map((tier) => (
            <span key={tier.inputTokenThreshold}>
              Above {tier.inputTokenThreshold.toLocaleString()}: {formatRate(tier.inputPricePer1M)}
              /M input · {formatRate(tier.outputPricePer1M)}/M output
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
