import { describe, expect, it } from "vitest";
import { toRequestLogCreateInput, toRequestLogFinalizeInput } from "../src/request-log-worker";

describe("request-log-worker toRequestLogCreateInput", () => {
  const baseEntry = {
    logId: "log-1",
    apiKeyId: "key-1",
    provider: "openai",
    model: "openai:gpt-4o",
    endpoint: "/v1/responses",
    latencyMs: 200,
    statusCode: 200,
  };

  it("forwards reasoning_tokens to the Prisma create input", () => {
    const input = toRequestLogCreateInput({
      ...baseEntry,
      reasoningTokens: 42,
    });
    expect(input).toMatchObject({
      id: "log-1",
      reasoningTokens: 42,
    });
  });

  it("forwards the requested model separately from the concrete model", () => {
    const input = toRequestLogCreateInput({
      ...baseEntry,
      requestedModel: "fast-chat",
    });

    expect(input).toMatchObject({
      model: "openai:gpt-4o",
      requestedModel: "fast-chat",
    });
  });

  it("forwards applied pricing audit fields", () => {
    const input = toRequestLogCreateInput({
      ...baseEntry,
      pricingInputTokens: 250_000,
      appliedInputPricePer1M: 2.5,
      appliedOutputPricePer1M: 15,
      appliedPricingTierThreshold: 200_000,
    });
    expect(input).toMatchObject({
      pricingInputTokens: 250_000,
      appliedInputPricePer1M: 2.5,
      appliedOutputPricePer1M: 15,
      appliedPricingTierThreshold: 200_000,
    });
  });

  it("leaves reasoning_tokens undefined when not provided", () => {
    const input = toRequestLogCreateInput(baseEntry);
    expect(input.reasoningTokens).toBeUndefined();
  });

  it("writes null errorMessage when none is provided", () => {
    const input = toRequestLogCreateInput(baseEntry);
    expect(input.errorMessage).toBeNull();
  });

  it("builds finalized stream updates with nullable token fields", () => {
    const input = toRequestLogFinalizeInput({
      ...baseEntry,
      latencyMs: 250,
      promptTokens: 10,
      requestedModel: "fast-chat",
      totalTokens: 18,
      statusCode: 200,
    });

    expect(input).toMatchObject({
      latencyMs: 250,
      promptTokens: 10,
      requestedModel: "fast-chat",
      completionTokens: null,
      totalTokens: 18,
      statusCode: 200,
      errorMessage: null,
    });
  });
});
