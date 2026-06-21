import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "claudinio",
    name: "Claudinio",
    provider: "claudinio",
    inputPricePer1M: 0.5,
    outputPricePer1M: 2,
    contextWindow: 256000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "audio", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "claudius",
    name: "Claudius",
    provider: "claudinio",
    inputPricePer1M: 3,
    outputPricePer1M: 8,
    contextWindow: 256000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "audio", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class ClaudinioAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "claudinio", apiKey, models: MODELS, apiBase: "https://api.claudin.io/v1" });
  }
}
