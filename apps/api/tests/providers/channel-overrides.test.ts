import { describe, expect, it } from "vitest";
import {
  applyChannelOverrides,
  ChannelHeaderOverrideError,
  ChannelParamOverrideConfigError,
  ChannelParamOverrideError,
} from "../../src/providers/channel-overrides";

describe("channel overrides", () => {
  it("applies legacy values and ordered body operations", () => {
    const body = {
      model: "gpt-5",
      temperature: 0.7,
      messages: [{ role: "user", content: "  HI  " }],
    };

    const result = applyChannelOverrides(body, {
      paramOverride: {
        temperature: 0.2,
        operations: [
          { mode: "trim_space", path: "messages.*.content" },
          { mode: "to_lower", path: "messages.0.content" },
          { mode: "set", path: "metadata.trace", value: "yes" },
        ],
      },
    });

    expect(result.body).toEqual({
      model: "gpt-5",
      temperature: 0.2,
      messages: [{ role: "user", content: "hi" }],
      metadata: { trace: "yes" },
    });
    expect(result.headers).toEqual({});
  });

  it("resolves static header overrides, placeholders, and safe passthrough", () => {
    const result = applyChannelOverrides(
      { model: "gpt-4o" },
      {
        apiKey: "sk-upstream",
        headerOverride: {
          "*": "",
          "X-Api-Key": "{api_key}",
          "X-Upstream-Trace": "{client_header:X-Trace-Id}",
          "X-Static": "static",
        },
      },
      {
        clientHeaders: new Headers({
          "Accept-Encoding": "gzip",
          Authorization: "Bearer client",
          "X-Trace-Id": "trace-123",
        }),
      },
    );

    expect(result.headers).toEqual({
      "x-api-key": "sk-upstream",
      "x-static": "static",
      "x-trace-id": "trace-123",
      "x-upstream-trace": "trace-123",
    });
  });

  it("uses param override header operations as the final header map", () => {
    const result = applyChannelOverrides(
      { model: "gpt-4o" },
      {
        headerOverride: {
          "X-Delete": "legacy",
          "X-Static": "static",
        },
        paramOverride: {
          operations: [
            { mode: "pass_headers", value: ["Originator", "Missing"] },
            { mode: "delete_header", path: "X-Delete" },
            { mode: "set_header", path: "X-Injected", value: "enabled" },
          ],
        },
      },
      {
        clientHeaders: new Headers({ Originator: "Codex CLI" }),
      },
    );

    expect(result.headers).toEqual({
      originator: "Codex CLI",
      "x-injected": "enabled",
      "x-static": "static",
    });
  });

  it("ignores missing copy_header and move_header sources", () => {
    const result = applyChannelOverrides(
      { model: "gpt-4o" },
      {
        paramOverride: {
          operations: [
            { mode: "copy_header", from: "Missing-Copy", to: "X-Copy" },
            { mode: "move_header", from: "Missing-Move", to: "X-Move" },
            { mode: "set_header", path: "X-Static", value: "ok" },
          ],
        },
      },
      {
        clientHeaders: new Headers({}),
      },
    );

    expect(result.headers).toEqual({ "x-static": "ok" });
  });

  it("supports conditions from request headers", () => {
    const body = { model: "gpt-4o", temperature: 1 };

    const result = applyChannelOverrides(
      body,
      {
        paramOverride: {
          operations: [
            {
              mode: "set",
              path: "temperature",
              value: 0,
              conditions: [{ path: "request_headers.x-mode", mode: "full", value: "strict" }],
            },
          ],
        },
      },
      {
        clientHeaders: new Headers({ "X-Mode": "strict" }),
      },
    );

    expect(result.body.temperature).toBe(0);
  });

  it("throws configured return_error responses", () => {
    expect(() =>
      applyChannelOverrides(
        { model: "gpt-4o" },
        {
          paramOverride: {
            operations: [
              {
                mode: "return_error",
                value: {
                  message: "blocked by channel policy",
                  status_code: 422,
                  code: "policy_blocked",
                  type: "invalid_request_error",
                },
              },
            ],
          },
        },
      ),
    ).toThrowError(ChannelParamOverrideError);
  });

  it("rejects invalid return_error status as param override config", () => {
    expect(() =>
      applyChannelOverrides(
        { model: "gpt-4o" },
        {
          paramOverride: {
            operations: [
              {
                mode: "return_error",
                value: { message: "bad config", status_code: 99 },
              },
            ],
          },
        },
      ),
    ).toThrowError(ChannelParamOverrideConfigError);
  });

  it("rejects empty and invalid header passthrough regex rules", () => {
    expect(() =>
      applyChannelOverrides(
        { model: "gpt-4o" },
        {
          headerOverride: { "re:": "" },
        },
      ),
    ).toThrowError(ChannelHeaderOverrideError);

    expect(() =>
      applyChannelOverrides(
        { model: "gpt-4o" },
        {
          headerOverride: { "regex:[": "" },
        },
      ),
    ).toThrowError(ChannelHeaderOverrideError);
  });
});
