import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "mercury-edit-2",
    name: "Mercury Edit 2",
    provider: "inception",
    inputPricePer1M: 0.25,
    outputPricePer1M: 0.75,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "mercury-2",
    name: "Mercury 2",
    provider: "inception",
    inputPricePer1M: 0.25,
    outputPricePer1M: 0.75,
    contextWindow: 128000,
    maxOutputTokens: 50000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
];

export class InceptionAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "inception",
      apiKey,
      models: MODELS,
      apiBase: "https://api.inceptionlabs.ai/v1/",
    });
  }
}
