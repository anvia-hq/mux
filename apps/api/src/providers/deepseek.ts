import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    inputPricePer1M: 0.14,
    outputPricePer1M: 0.28,
    contextWindow: 1000000,
    maxOutputTokens: 384000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    inputPricePer1M: 0.435,
    outputPricePer1M: 0.87,
    contextWindow: 1000000,
    maxOutputTokens: 384000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "deepseek",
    inputPricePer1M: 0.14,
    outputPricePer1M: 0.28,
    contextWindow: 1000000,
    maxOutputTokens: 384000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    inputPricePer1M: 0.14,
    outputPricePer1M: 0.28,
    contextWindow: 1000000,
    maxOutputTokens: 384000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class DeepseekAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "deepseek", apiKey, models: MODELS, apiBase: "https://api.deepseek.com" });
  }
}
