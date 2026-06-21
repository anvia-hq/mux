import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "morph-v3-fast",
    name: "Morph v3 Fast",
    provider: "morph",
    inputPricePer1M: 0.8,
    outputPricePer1M: 1.2,
    contextWindow: 16000,
    maxOutputTokens: 16000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "morph-v3-large",
    name: "Morph v3 Large",
    provider: "morph",
    inputPricePer1M: 0.9,
    outputPricePer1M: 1.9,
    contextWindow: 32000,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "auto",
    name: "Auto",
    provider: "morph",
    inputPricePer1M: 0.85,
    outputPricePer1M: 1.55,
    contextWindow: 32000,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
];

export class MorphAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "morph", apiKey, models: MODELS, apiBase: "https://api.morphllm.com/v1" });
  }
}
