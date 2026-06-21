import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "sonar-reasoning-pro",
    name: "Sonar Reasoning Pro",
    provider: "perplexity",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "sonar",
    name: "Sonar",
    provider: "perplexity",
    inputPricePer1M: 1,
    outputPricePer1M: 1,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "sonar-pro",
    name: "Sonar Pro",
    provider: "perplexity",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "sonar-deep-research",
    name: "Perplexity Sonar Deep Research",
    provider: "perplexity",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 128000,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
];

export class PerplexityAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "perplexity", apiKey, models: MODELS });
  }
}
