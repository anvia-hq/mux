import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "hy3-preview",
    name: "Hy3 preview",
    provider: "tencent-tokenhub",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 256000,
    maxOutputTokens: 64000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class TencentTokenhubAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "tencent-tokenhub",
      apiKey,
      models: MODELS,
      apiBase: "https://tokenhub.tencentmaas.com/v1",
    });
  }
}
