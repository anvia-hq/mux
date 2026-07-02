import { describe, expect, it } from "vitest";
import {
  upstreamOpenAICompatibleErrorResponse,
  UpstreamOpenAICompatibleError,
} from "../../src/providers/openai-compatible-error";

describe("openai-compatible error helpers", () => {
  it("preserves an empty upstream error body", async () => {
    const response = upstreamOpenAICompatibleErrorResponse(
      new UpstreamOpenAICompatibleError({
        provider: "openai",
        status: 502,
        body: "",
        contentType: "text/plain",
      }),
    );

    expect(response?.status).toBe(502);
    expect(response?.headers.get("Content-Type")).toContain("text/plain");
    await expect(response?.text()).resolves.toBe("");
  });
});
