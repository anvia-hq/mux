import { describe, expect, it, vi } from "vitest";
import { toRequestLogCreateInput } from "./request-log-worker";

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

  it("leaves reasoning_tokens undefined when not provided", () => {
    const input = toRequestLogCreateInput(baseEntry);
    expect(input.reasoningTokens).toBeUndefined();
  });

  it("writes null errorMessage when none is provided", () => {
    const input = toRequestLogCreateInput(baseEntry);
    expect(input.errorMessage).toBeNull();
  });
});
