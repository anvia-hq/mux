import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "Ring-1T",
    name: "Ring-1T",
    provider: "bailing",
    inputPricePer1M: 0.57,
    outputPricePer1M: 2.29,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "Ling-1T",
    name: "Ling-1T",
    provider: "bailing",
    inputPricePer1M: 0.57,
    outputPricePer1M: 2.29,
    contextWindow: 128000,
    maxOutputTokens: 32000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class BailingAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "bailing",
      apiKey,
      models: MODELS,
      apiBase: "https://api.tbox.cn/api/llm/v1/chat/completions",
    });
  }
}
