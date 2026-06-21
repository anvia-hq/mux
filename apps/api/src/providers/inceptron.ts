import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "moonshotai/Kimi-K2.6",
    name: "Kimi K2.6",
    provider: "inceptron",
    inputPricePer1M: 0.78,
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
    id: "nvidia/llama-3.3-70b-instruct-fp8",
    name: "Llama 3.3 70B Instruct",
    provider: "inceptron",
    inputPricePer1M: 0.12,
    outputPricePer1M: 0.38,
    contextWindow: 131072,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "zai-org/GLM-5.1-FP8",
    name: "GLM 5.1",
    provider: "inceptron",
    inputPricePer1M: 1.4,
    outputPricePer1M: 4.4,
    contextWindow: 202752,
    maxOutputTokens: 202752,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "MiniMaxAI/MiniMax-M2.5",
    name: "MiniMax M2.5",
    provider: "inceptron",
    inputPricePer1M: 0.24,
    outputPricePer1M: 0.9,
    contextWindow: 196608,
    maxOutputTokens: 196608,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
];

export class InceptronAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "inceptron", apiKey, models: MODELS, apiBase: "https://api.inceptron.io/v1" });
  }
}
