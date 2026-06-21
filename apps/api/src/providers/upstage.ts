import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "solar-pro2",
    name: "solar-pro2",
    provider: "upstage",
    inputPricePer1M: 0.25,
    outputPricePer1M: 0.25,
    contextWindow: 65536,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "solar-pro3",
    name: "solar-pro3",
    provider: "upstage",
    inputPricePer1M: 0.25,
    outputPricePer1M: 0.25,
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "solar-mini",
    name: "solar-mini",
    provider: "upstage",
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.15,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class UpstageAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "upstage", apiKey, models: MODELS, apiBase: "https://api.upstage.ai/v1/solar" });
  }
}
