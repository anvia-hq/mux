import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "gpt-oss-120b",
    name: "GPT OSS 120B",
    provider: "cerebras",
    inputPricePer1M: 0.35,
    outputPricePer1M: 0.75,
    contextWindow: 131072,
    maxOutputTokens: 40960,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "zai-glm-4.7",
    name: "Z.AI GLM-4.7",
    provider: "cerebras",
    inputPricePer1M: 2.25,
    outputPricePer1M: 2.75,
    contextWindow: 131072,
    maxOutputTokens: 40960,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
];

export class CerebrasAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "cerebras", apiKey, models: MODELS });
  }
}
