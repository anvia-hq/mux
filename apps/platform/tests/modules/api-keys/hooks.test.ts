import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

import { apiFetch, ApiError } from "../../../src/lib/api-client";
import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevealApiKeyMutation,
  useRevokeApiKeyMutation,
  useRotateApiKeyMutation,
  useUpdateApiKeyModelAccessMutation,
  isForbiddenError,
} from "../../../src/modules/api-keys/hooks";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("api-keys hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("useApiKeysQuery", () => {
    it("fetches /api-keys", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ keys: [{ id: "k1", name: "test" }] });
      const { result } = renderHook(() => useApiKeysQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({ keys: [{ id: "k1", name: "test" }] });
    });
  });

  describe("useCreateApiKeyMutation", () => {
    it("posts to /api-keys with name and spend limit", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ id: "k2", key: "mux_live_xxx" });
      const { result } = renderHook(() => useCreateApiKeyMutation(), { wrapper });
      await act(() => result.current.mutateAsync({ name: "new-key", spendLimitUsd: 10 }));
      expect(apiFetch).toHaveBeenCalledWith("/api-keys", {
        method: "POST",
        body: { name: "new-key", spendLimitUsd: 10 },
      });
    });

    it("posts selected model filters to /api-keys", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ id: "k2", key: "mux_live_xxx" });
      const { result } = renderHook(() => useCreateApiKeyMutation(), { wrapper });
      await act(() =>
        result.current.mutateAsync({
          name: "filtered-key",
          spendLimitUsd: null,
          allowedModelIds: ["openai:gpt-4o", "mux:fast"],
        }),
      );
      expect(apiFetch).toHaveBeenCalledWith("/api-keys", {
        method: "POST",
        body: {
          name: "filtered-key",
          spendLimitUsd: null,
          allowedModelIds: ["openai:gpt-4o", "mux:fast"],
        },
      });
    });
  });

  describe("useRevokeApiKeyMutation", () => {
    it("deletes /api-keys/:id", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useRevokeApiKeyMutation(), { wrapper });
      await act(() => result.current.mutateAsync("k1"));
      expect(apiFetch).toHaveBeenCalledWith("/api-keys/k1", { method: "DELETE" });
    });
  });

  describe("useRevealApiKeyMutation", () => {
    it("gets /api-keys/:id/reveal", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ key: "mux_live_saved" });
      const { result } = renderHook(() => useRevealApiKeyMutation(), { wrapper });
      await act(() => result.current.mutateAsync("k1"));
      expect(apiFetch).toHaveBeenCalledWith("/api-keys/k1/reveal");
    });
  });

  describe("useRotateApiKeyMutation", () => {
    it("posts /api-keys/:id/rotate", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ key: "mux_live_new" });
      const { result } = renderHook(() => useRotateApiKeyMutation(), { wrapper });
      await act(() => result.current.mutateAsync("k1"));
      expect(apiFetch).toHaveBeenCalledWith("/api-keys/k1/rotate", { method: "POST" });
    });
  });

  describe("useUpdateApiKeyModelAccessMutation", () => {
    it("patches /api-keys/:id/model-access", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
      const { result } = renderHook(() => useUpdateApiKeyModelAccessMutation(), { wrapper });
      await act(() =>
        result.current.mutateAsync({
          id: "k1",
          mode: "selected",
          allowedModelIds: ["openai:gpt-4o"],
        }),
      );
      expect(apiFetch).toHaveBeenCalledWith("/api-keys/k1/model-access", {
        method: "PATCH",
        body: { mode: "selected", allowedModelIds: ["openai:gpt-4o"] },
      });
    });
  });

  describe("isForbiddenError", () => {
    it("returns true for ApiError with status 403", () => {
      expect(isForbiddenError(new ApiError(403, "forbidden", null))).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isForbiddenError(new Error("test"))).toBe(false);
      expect(isForbiddenError(new ApiError(500, "server error", null))).toBe(false);
    });
  });
});
