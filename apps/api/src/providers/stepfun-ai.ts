import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "step-3.5-flash",
    name: "Step 3.5 Flash",
    provider: "stepfun-ai",
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
    id: "step-3.5-flash-2603",
    name: "Step 3.5 Flash 2603",
    provider: "stepfun-ai",
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
];

export class StepfunAiAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "stepfun-ai",
      apiKey,
      models: MODELS,
      apiBase: "https://api.stepfun.ai/step_plan/v1",
    });
  }
}
