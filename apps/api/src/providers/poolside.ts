import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "poolside/laguna-xs.2",
    name: "Laguna XS.2",
    provider: "poolside",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "poolside/laguna-m.1",
    name: "Laguna M.1",
    provider: "poolside",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class PoolsideAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "poolside",
      apiKey,
      models: MODELS,
      apiBase: "https://inference.poolside.ai/v1",
    });
  }
}
