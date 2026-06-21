import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "abliterated-model",
    name: "Abliterated Model",
    provider: "abliteration-ai",
    inputPricePer1M: 3,
    outputPricePer1M: 3,
    contextWindow: 150000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class AbliterationAiAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "abliteration-ai",
      apiKey,
      models: MODELS,
      apiBase: "https://api.abliteration.ai/v1",
    });
  }
}
