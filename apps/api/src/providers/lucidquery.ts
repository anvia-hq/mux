import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "lucidnova-rf1-100b",
    name: "LucidNova RF1 100B",
    provider: "lucidquery",
    inputPricePer1M: 2,
    outputPricePer1M: 5,
    contextWindow: 120000,
    maxOutputTokens: 8000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "lucidquery-nexus-coder",
    name: "LucidQuery Nexus Coder",
    provider: "lucidquery",
    inputPricePer1M: 2,
    outputPricePer1M: 5,
    contextWindow: 250000,
    maxOutputTokens: 60000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "lucidquery-agi-01-swift",
    name: "AGI-01 Swift",
    provider: "lucidquery",
    inputPricePer1M: 2.5,
    outputPricePer1M: 15,
    contextWindow: 300000,
    maxOutputTokens: 120000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "lucidquery-agi-01-frontier",
    name: "AGI-01 Frontier",
    provider: "lucidquery",
    inputPricePer1M: 4.5,
    outputPricePer1M: 22,
    contextWindow: 300000,
    maxOutputTokens: 120000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class LucidqueryAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "lucidquery", apiKey, models: MODELS, apiBase: "https://api.lucidquery.com/v1" });
  }
}
