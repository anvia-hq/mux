import { describe, expect, it } from "vitest";
import { UpstreamAnthropicMessagesApiError } from "../../../src/providers/anthropic";
import { readMessagesRelayConfig } from "../../../src/modules/messages/relay/config";
import {
  anthropicRelayError,
  retryableMessagesError,
} from "../../../src/modules/messages/relay/errors";
import { estimateAnthropicMessageInputTokens } from "../../../src/modules/messages/relay/token-estimator";

describe("Messages relay primitives", () => {
  it("reads retry, timeout, body, and rate-limit settings", () => {
    const config = readMessagesRelayConfig({
      MESSAGES_RETRY_COUNT: "4",
      MESSAGES_RETRY_STATUS_CODES: "429,500-503",
      MESSAGES_FIRST_BYTE_TIMEOUT_MS: "101",
      MESSAGES_STREAM_IDLE_TIMEOUT_MS: "102",
      MESSAGES_NON_STREAM_TIMEOUT_MS: "103",
      MESSAGES_MAX_REQUEST_BODY_MB: "2",
      MESSAGES_RATE_LIMIT_WINDOW_SECONDS: "30",
      MESSAGES_RATE_LIMIT_TOTAL: "10",
      MESSAGES_RATE_LIMIT_SUCCESS: "8",
    });

    expect(config).toMatchObject({
      retryCount: 4,
      firstByteTimeoutMs: 101,
      streamIdleTimeoutMs: 102,
      nonStreamTimeoutMs: 103,
      maxRequestBodyBytes: 2 * 1024 * 1024,
      rateLimitWindowSeconds: 30,
      rateLimitTotal: 10,
      rateLimitSuccess: 8,
    });
    expect(config.retryStatusCodes).toEqual([
      { start: 429, end: 429 },
      { start: 500, end: 503 },
    ]);
  });

  it("retries only configured Anthropic upstream statuses", () => {
    const config = readMessagesRelayConfig({
      MESSAGES_RETRY_STATUS_CODES: "429,500-599",
    });
    expect(
      retryableMessagesError(
        new UpstreamAnthropicMessagesApiError(429, "{}", "application/json"),
        config,
      ),
    ).toBe(true);
    expect(
      retryableMessagesError(
        new UpstreamAnthropicMessagesApiError(400, "{}", "application/json"),
        config,
      ),
    ).toBe(false);
  });

  it("preserves useful upstream error fields while masking credentials", () => {
    const result = anthropicRelayError(
      new UpstreamAnthropicMessagesApiError(
        429,
        JSON.stringify({
          type: "error",
          error: {
            type: "rate_limit_error",
            message: "authorization: Bearer sk-secretsecretsecret",
          },
        }),
        "application/json",
        "9",
      ),
      "req-1",
    );

    expect(result).toEqual({
      status: 429,
      retryAfter: "9",
      body: {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "authorization: [REDACTED] (request_id: req-1)",
        },
        request_id: "req-1",
      },
    });
  });

  it("includes system, message, tool, and thinking payloads in spend estimation", () => {
    const base = estimateAnthropicMessageInputTokens({
      model: "claude-test",
      messages: [{ role: "user", content: "hello" }],
    });
    const expanded = estimateAnthropicMessageInputTokens({
      model: "claude-test",
      system: "Follow the policy",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "lookup", input_schema: { type: "object" } }],
      thinking: { type: "enabled", budget_tokens: 1000 },
    });
    expect(expanded).toBeGreaterThan(base);
  });
});
