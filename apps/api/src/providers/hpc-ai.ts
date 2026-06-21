import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "hpc-ai",
    inputPricePer1M: 0.3,
    outputPricePer1M: 1.5,
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
    id: "zai-org/glm-5.1",
    name: "GLM 5.1",
    provider: "hpc-ai",
    inputPricePer1M: 0.615,
    outputPricePer1M: 2.46,
    contextWindow: 202000,
    maxOutputTokens: 202000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "open",
  },
  {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    provider: "hpc-ai",
    inputPricePer1M: 0.3,
    outputPricePer1M: 1.2,
    contextWindow: 1000000,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class HpcAiAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "hpc-ai",
      apiKey,
      models: MODELS,
      apiBase: "https://api.hpc-ai.com/inference/v1",
    });
  }
}
