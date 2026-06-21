import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "moonshotai/kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    provider: "ambient",
    inputPricePer1M: 0.75,
    outputPricePer1M: 3.5,
    contextWindow: 262144,
    maxOutputTokens: 262144,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "moonshotai/kimi-k2.6",
    name: "Kimi K2.6",
    provider: "ambient",
    inputPricePer1M: 0.95,
    outputPricePer1M: 4,
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
    id: "zai-org/GLM-5.1-FP8",
    name: "GLM 5.1",
    provider: "ambient",
    inputPricePer1M: 1.4,
    outputPricePer1M: 4.4,
    contextWindow: 202752,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
];

export class AmbientAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "ambient", apiKey, models: MODELS, apiBase: "https://api.ambient.xyz/v1" });
  }
}
