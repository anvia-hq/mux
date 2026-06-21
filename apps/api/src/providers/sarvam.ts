import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "sarvam-105b",
    name: "Sarvam-105B",
    provider: "sarvam",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 131072,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "sarvam-30b",
    name: "Sarvam-30B",
    provider: "sarvam",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 65536,
    maxOutputTokens: 65536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class SarvamAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "sarvam", apiKey, models: MODELS, apiBase: "https://api.sarvam.ai/v1" });
  }
}
