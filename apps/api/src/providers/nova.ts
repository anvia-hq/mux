import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "nova-2-pro-v1",
    name: "Nova 2 Pro",
    provider: "nova",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
  {
    id: "nova-2-lite-v1",
    name: "Nova 2 Lite",
    provider: "nova",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    inputModalities: ["text", "image", "video", "pdf"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class NovaAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "nova", apiKey, models: MODELS, apiBase: "https://api.nova.amazon.com/v1" });
  }
}
