import { describe, expect, it } from "vitest";
import { UpstreamOpenAICompatibleError } from "../../../../src/providers/openai-compatible-error";
import {
  ChatRelayTimeoutError,
  sanitizedRelayError,
} from "../../../../src/modules/chat/relay/errors";

describe("chat relay errors", () => {
  it("preserves structured upstream fields while masking credentials", () => {
    const result = sanitizedRelayError(
      new UpstreamOpenAICompatibleError({
        provider: "test",
        status: 429,
        retryAfter: "3",
        body: JSON.stringify({
          error: {
            message: "authorization: Bearer sk-secretsecret failed",
            type: "rate_limit_error",
            code: "rate_limit",
          },
        }),
      }),
      "req-1",
    );
    expect(result).toMatchObject({ status: 429, retryAfter: "3" });
    expect(result.body.error).toMatchObject({ type: "rate_limit_error", code: "rate_limit" });
    expect(result.body.error.message).toContain("[REDACTED]");
    expect(result.body.error.message).toContain("request_id: req-1");
    expect(result.body.error.message).not.toContain("sk-secretsecret");
  });

  it("hides malformed bodies and normalizes timeouts", () => {
    const malformed = sanitizedRelayError(
      new UpstreamOpenAICompatibleError({ provider: "test", status: 502, body: "proxy html" }),
      "req-2",
    );
    expect(malformed.body.error.message).toContain("bad response status code 502");
    expect(malformed.body.error.message).not.toContain("proxy html");
    expect(sanitizedRelayError(new ChatRelayTimeoutError("first_byte"), "req-3").status).toBe(504);
  });

  it("masks common provider credential formats", () => {
    const error = new UpstreamOpenAICompatibleError({
      provider: "test",
      status: 401,
      body: JSON.stringify({
        error: {
          message: "x-api-key: sk-ant-api03-longsecretvalue api_key=AIza0123456789abcdefghijklmnop",
        },
      }),
    });
    const message = sanitizedRelayError(error, "req-4").body.error.message;
    expect(message).not.toContain("sk-ant-api03-longsecretvalue");
    expect(message).not.toContain("AIza0123456789abcdefghijklmnop");
    expect(message.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});
