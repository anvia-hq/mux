import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "k2p7",
    name: "Kimi K2.7 Code",
    provider: "kimi-for-coding",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    provider: "kimi-for-coding",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "k2p5",
    name: "Kimi K2.5",
    provider: "kimi-for-coding",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "k2p6",
    name: "Kimi K2.6",
    provider: "kimi-for-coding",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 32768,
    inputModalities: ["text", "image", "video"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
];

export class KimiForCodingAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "kimi-for-coding",
      apiKey,
      models: MODELS,
      apiBase: "https://api.kimi.com/coding/v1",
    });
  }
}
