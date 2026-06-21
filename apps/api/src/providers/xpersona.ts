import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "xpersona-gpt-5.5",
    name: "GPT-5.5",
    provider: "xpersona",
    inputPricePer1M: 3,
    outputPricePer1M: 18,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
  {
    id: "xpersona-frieren-coder",
    name: "Xpersona Frieren 1",
    provider: "xpersona",
    inputPricePer1M: 1.5,
    outputPricePer1M: 6,
    contextWindow: 1000000,
    maxOutputTokens: 384000,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    weights: "closed",
  },
];

export class XpersonaAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({ name: "xpersona", apiKey, models: MODELS, apiBase: "https://www.xpersona.co/v1" });
  }
}
