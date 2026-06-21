import { ModelsDevProviderAdapter } from "./models-dev-provider-adapter";
import type { Model } from "./types";

const MODELS: Model[] = [
  {
    id: "GLM-4.7",
    name: "GLM-4.7",
    provider: "kuae-cloud-coding-plan",
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    contextWindow: 204800,
    maxOutputTokens: 131072,
    inputModalities: ["text"],
    outputModalities: ["text"],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    weights: "open",
  },
];

export class KuaeCloudCodingPlanAdapter extends ModelsDevProviderAdapter {
  constructor(apiKey: string) {
    super({
      name: "kuae-cloud-coding-plan",
      apiKey,
      models: MODELS,
      apiBase: "https://coding-plan-endpoint.kuaecloud.net/v1",
    });
  }
}
