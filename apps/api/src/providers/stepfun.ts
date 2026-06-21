import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "step-1-32k",
    name: "Step 1 (32K)",
    provider: "stepfun",
    inputPricePer1M: 2.05,
    outputPricePer1M: 9.59,
    contextWindow: 32768,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "step-3.5-flash-2603",
    name: "Step 3.5 Flash 2603",
    provider: "stepfun",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.3,
    contextWindow: 256000,
    maxOutputTokens: 256000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "step-3.5-flash",
    name: "Step 3.5 Flash",
    provider: "stepfun",
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.3,
    contextWindow: 256000,
    maxOutputTokens: 256000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "step-2-16k",
    name: "Step 2 (16K)",
    provider: "stepfun",
    inputPricePer1M: 5.21,
    outputPricePer1M: 16.44,
    contextWindow: 16384,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class StepfunAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "stepfun", apiKey, models: MODELS, apiBase: "https://api.stepfun.com/v1" });
  }
}
