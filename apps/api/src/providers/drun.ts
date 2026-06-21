import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "public/deepseek-v3",
    name: "DeepSeek V3",
    provider: "drun",
    inputPricePer1M: 0.28,
    outputPricePer1M: 1.1,
    contextWindow: 131072,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "public/deepseek-r1",
    name: "DeepSeek R1",
    provider: "drun",
    inputPricePer1M: 0.55,
    outputPricePer1M: 2.2,
    contextWindow: 131072,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "public/minimax-m25",
    name: "MiniMax M2.5",
    provider: "drun",
    inputPricePer1M: 0.29,
    outputPricePer1M: 1.16,
    contextWindow: 204800,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "closed",
  },
];

export class DrunAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "drun", apiKey, models: MODELS, apiBase: "https://chat.d.run/v1" });
  }
}
