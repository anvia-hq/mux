import { describe, expect, it } from "vitest";
import {
  applyChannelChatRequestSettings,
  applyChannelResponseRequestSettings,
} from "../../src/providers/channel-settings";
import type { ChatCompletionRequest, ResponseCreateRequest } from "../../src/providers/types";

describe("channel request settings", () => {
  it("filters restricted OpenAI-compatible fields by default", () => {
    const request: ResponseCreateRequest = {
      model: "gpt-4o",
      input: "hello",
      service_tier: "flex",
      safety_identifier: "safe-id",
      stream_options: { include_obfuscation: true },
    };

    const body = applyChannelResponseRequestSettings(request, {});

    expect(body).toEqual({
      model: "gpt-4o",
      input: "hello",
    });
  });

  it("passes restricted OpenAI-compatible fields only when allowed", () => {
    const request: ResponseCreateRequest = {
      model: "gpt-4o",
      input: "hello",
      service_tier: "flex",
      safety_identifier: "safe-id",
      store: true,
      stream_options: { include_obfuscation: true },
    };

    const body = applyChannelResponseRequestSettings(request, {
      otherSettings: {
        allowServiceTier: true,
        allowSafetyIdentifier: true,
        allowIncludeObfuscation: true,
      },
    });

    expect(body).toEqual({
      model: "gpt-4o",
      input: "hello",
      service_tier: "flex",
      safety_identifier: "safe-id",
      store: true,
      stream_options: { include_obfuscation: true },
    });
  });

  it("removes store only when disableStore is configured", () => {
    const request: ResponseCreateRequest = {
      model: "gpt-4o",
      input: "hello",
      store: true,
    };

    const body = applyChannelResponseRequestSettings(request, {
      otherSettings: { disableStore: true },
    });

    expect(body).toEqual({
      model: "gpt-4o",
      input: "hello",
    });
  });

  it("adds channel system prompts and applies parameter overrides for chat requests", () => {
    const request: ChatCompletionRequest = {
      model: "gpt-5",
      messages: [{ role: "user", content: "hello" }],
      temperature: 1,
    };

    const body = applyChannelChatRequestSettings(request, {
      settings: { systemPrompt: "Be concise" },
      paramOverride: { temperature: 0 },
    });

    expect(body).toMatchObject({
      model: "gpt-5",
      temperature: 0,
      messages: [
        { role: "developer", content: "Be concise" },
        { role: "user", content: "hello" },
      ],
    });
  });

  it("skips body filtering and parameter override when pass-through body is enabled", () => {
    const request: ResponseCreateRequest = {
      model: "gpt-4o",
      input: "hello",
      service_tier: "flex",
      temperature: 1,
      stream_options: { include_obfuscation: true },
    };

    const body = applyChannelResponseRequestSettings(request, {
      settings: { passThroughBodyEnabled: true },
      paramOverride: { temperature: 0 },
    });

    expect(body).toEqual(request);
  });
});
