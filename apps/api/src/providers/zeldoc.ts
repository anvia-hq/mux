import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "z-code",
    name: "Z-Code",
    provider: "zeldoc",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
];

export class ZeldocAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "zeldoc", apiKey, models: MODELS, apiBase: "https://api.zeldoc.ai/v1" });
  }
}
