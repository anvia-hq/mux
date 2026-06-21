import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "lilac",
    inputPricePer1M: 0.7,
    outputPricePer1M: 3.5,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "minimaxai/minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "lilac",
    inputPricePer1M: 0.3,
    outputPricePer1M: 1.2,
    contextWindow: 204800,
    maxOutputTokens: 204800,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "google/gemma-4-31b-it",
    name: "Gemma 4 31B IT",
    provider: "lilac",
    inputPricePer1M: 0.11,
    outputPricePer1M: 0.35,
    contextWindow: 262100,
    maxOutputTokens: 262100,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "zai-org/glm-5.1",
    name: "GLM 5.1",
    provider: "lilac",
    inputPricePer1M: 0.9,
    outputPricePer1M: 3,
    contextWindow: 202800,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
];

export class LilacAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "lilac", apiKey, models: MODELS, apiBase: "https://api.getlilac.com/v1" });
  }
}
