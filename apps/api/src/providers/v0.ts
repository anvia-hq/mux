import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "v0-1.0-md",
    name: "v0-1.0-md",
    provider: "v0",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "v0-1.5-lg",
    name: "v0-1.5-lg",
    provider: "v0",
    inputPricePer1M: 15,
    outputPricePer1M: 75,
    contextWindow: 512000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "v0-1.5-md",
    name: "v0-1.5-md",
    provider: "v0",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class V0Adapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "v0", apiKey, models: MODELS });
  }
}
