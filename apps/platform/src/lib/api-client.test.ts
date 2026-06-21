import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnauthorizedError, apiBase, apiFetch } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("normalizes the configured API base URL", () => {
    expect(apiBase).toBe("/api");
  });

  it("sends JSON requests with credentials", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch<{ ok: boolean }>("/auth/login", { method: "POST", body: { email: "a" } }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "a" }),
    });
  });

  it("adds a leading slash when a path omits one", async () => {
    const fetchMock = vi.fn(async () => Response.json({ providers: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("providers");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/providers",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("throws UnauthorizedError for 401 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(apiFetch("/auth/me")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ApiError with server messages for failed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid request" }, { status: 400 })),
    );

    await expect(apiFetch("/auth/login")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "invalid request",
      body: { error: "invalid request" },
    } satisfies Partial<ApiError>);
  });

  it("returns null for empty successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(apiFetch("/auth/logout")).resolves.toBeNull();
  });
});
