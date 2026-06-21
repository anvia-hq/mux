import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "MiniMax-M2.1",
    name: "MiniMax-M2.1",
    provider: "moark",
    inputPricePer1M: 2.1,
    outputPricePer1M: 8.4,
    contextWindow: 204800,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "GLM-4.7",
    name: "GLM-4.7",
    provider: "moark",
    inputPricePer1M: 3.5,
    outputPricePer1M: 14,
    contextWindow: 204800,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class MoarkAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "moark", apiKey, models: MODELS, apiBase: "https://moark.com/v1" });
  }
}
