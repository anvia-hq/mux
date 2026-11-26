import { describe, expect, test } from "bun:test";
import { ApiRequestError, apiRequest } from "./api-client";
import { parseCommaTags, parseKeyValueLines } from "./format";

describe("apiRequest", () => {
  test("parses JSON payloads, handles 204 responses, and throws typed ApiRequestError on failures", async () => {
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
        fetchImpl: async () =>
          Response.json(
            { error: { code: "FORBIDDEN", message: "Admin required." } },
            { status: 403 },
          ),
      }),
    ).rejects.toThrow(ApiRequestError);

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
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).status).toBe(401);
      expect((error as ApiRequestError).code).toBe("INVALID_CREDENTIALS");
    }
  });
});

describe("format helpers", () => {
  test("parses header/secret key-value lines and rejects malformed entries", () => {
    expect(parseKeyValueLines("Authorization: Bearer abc=123\nAPI_KEY=sk_live_xyz\n\n")).toEqual({
      Authorization: "Bearer abc=123",
      API_KEY: "sk_live_xyz",
    });

    expect(() => parseKeyValueLines("malformed-line-without-delimiter")).toThrow();
    expect(parseCommaTags(" github:issues , , stripe:billing ")).toEqual([
      "github:issues",
      "stripe:billing",
    ]);
  });
});
