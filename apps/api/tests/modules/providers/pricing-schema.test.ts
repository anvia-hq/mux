import { describe, expect, it } from "vitest";
import { customProviderModelSchema } from "../../../src/modules/providers/schema";

const model = {
  id: "custom-model",
  name: "Custom Model",
  inputPricePer1M: 1,
  outputPricePer1M: 4,
  contextWindow: 1_000_000,
  maxOutputTokens: 32_000,
  inputModalities: ["text"],
  outputModalities: ["text"],
  reasoning: true,
  toolCall: true,
  structuredOutput: true,
  weights: "closed" as const,
};

describe("customProviderModelSchema pricing tiers", () => {
  it("defaults an omitted tier schedule to an empty array", () => {
    expect(customProviderModelSchema.parse(model).pricingTiers).toEqual([]);
  });

  it("accepts multiple valid model-specific thresholds", () => {
    const result = customProviderModelSchema.safeParse({
      ...model,
      pricingTiers: [
        { inputTokenThreshold: 200_000, inputPricePer1M: 2, outputPricePer1M: 6 },
        { inputTokenThreshold: 500_000, inputPricePer1M: 3, outputPricePer1M: 8 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate or unreachable thresholds", () => {
    const duplicate = { inputTokenThreshold: 200_000, inputPricePer1M: 2, outputPricePer1M: 6 };
    expect(
      customProviderModelSchema.safeParse({ ...model, pricingTiers: [duplicate, duplicate] })
        .success,
    ).toBe(false);
    expect(
      customProviderModelSchema.safeParse({
        ...model,
        pricingTiers: [{ ...duplicate, inputTokenThreshold: model.contextWindow }],
      }).success,
    ).toBe(false);
  });
});
