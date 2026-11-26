import { describe, expect, test } from "bun:test";
import { ApiRequestError, apiRequest } from "./api-client";
import { parseCommaTags, parseJsonObject, parseKeyValueLines } from "./format";

describe("apiRequest", () => {
  test("parses JSON payloads, handles 204 responses, rejects non-JSON 200s, and throws typed ApiRequestError on failures", async () => {
    const okData = await apiRequest<{ ok: boolean }>("/health", {
      fetchImpl: async () => Response.json({ ok: true }),
    });

    expect(okData).toEqual({ ok: true });

    const empty = await apiRequest<void>("/v1/endpoints/1", {
      method: "DELETE",
      fetchImpl: async () => new Response(null, { status: 204 }),
    });

    expect(empty).toBeUndefined();

    await expect(
      apiRequest("/v1/sources", {
        fetchImpl: async () => new Response("<html>not json</html>", { status: 200 }),
      }),
    ).rejects.toThrow("non-JSON");

    await expect(
      apiRequest("/v1/sources", {
        fetchImpl: async () =>
          Response.json(
            { error: { code: "FORBIDDEN", message: "Admin required." } },
            { status: 403 },
          ),
      }),
    ).rejects.toThrow(ApiRequestError);

    let caughtError: unknown = null;

    try {
      await apiRequest("/api/auth/sign-in/email", {
        method: "POST",
        body: { email: "a@b.c", password: "wrong" },
        fetchImpl: async () =>
          Response.json(
            { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
            { status: 401 },
          ),
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(ApiRequestError);
    expect((caughtError as ApiRequestError).status).toBe(401);
    expect((caughtError as ApiRequestError).code).toBe("INVALID_CREDENTIALS");
  });
});

describe("format helpers", () => {
  test("parses key-value lines with colons/equals, rejects leading delimiters, and validates JSON objects", () => {
    expect(
      parseKeyValueLines("Authorization: Bearer abc=123\nAPI_KEY=sk_live:with:colons\n\n"),
    ).toEqual({
      Authorization: "Bearer abc=123",
      API_KEY: "sk_live:with:colons",
    });

    expect(() => parseKeyValueLines("malformed-line-without-delimiter")).toThrow();
    expect(() => parseKeyValueLines("=foo:bar")).toThrow();
    expect(() => parseKeyValueLines(":foo=bar")).toThrow();

    expect(parseJsonObject('{"a":1}', "Arguments")).toEqual({ a: 1 });
    expect(() => parseJsonObject("[]", "Arguments")).toThrow("JSON object");
    expect(() => parseJsonObject("null", "Arguments")).toThrow("JSON object");
    expect(() => parseJsonObject('"text"', "Arguments")).toThrow("JSON object");
    expect(() => parseJsonObject("{bad", "Arguments")).toThrow("valid JSON");

    expect(parseCommaTags(" github:issues , , stripe:billing ")).toEqual([
      "github:issues",
      "stripe:billing",
    ]);
  });
});
