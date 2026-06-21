import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "lmstudio",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 131072,
    maxOutputTokens: 32768,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "qwen/qwen3-30b-a3b-2507",
    name: "Qwen3 30B A3B 2507",
    provider: "lmstudio",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 16384,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
  {
    id: "qwen/qwen3-coder-30b",
    name: "Qwen3 Coder 30B",
    provider: "lmstudio",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 262144,
    maxOutputTokens: 65536,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class LmstudioAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "lmstudio", apiKey, models: MODELS, apiBase: "http://127.0.0.1:1234/v1" });
  }
}
