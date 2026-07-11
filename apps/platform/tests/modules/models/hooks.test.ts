import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../../src/lib/api-client";
import { useModelTargetsQuery, useModelsQuery } from "../../../src/modules/models/hooks";

function createWrapper(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children),
  };
}

describe("models hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("useModelsQuery", () => {
    it("fetches /dashboard/models", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        data: [{ id: "gpt-4", name: "GPT-4", provider: "openai" }],
      });
      const { qc, wrapper } = createWrapper();
      const viewer = { id: "admin-1", role: "ADMIN" as const };
      const { result } = renderHook(() => useModelsQuery({ viewer }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith("/dashboard/models");
      expect(qc.getQueryData(["dashboard", "models", "admin-1", "ADMIN"])).toEqual({
        data: [{ id: "gpt-4", name: "GPT-4", provider: "openai" }],
      });
    });

    it("does not fetch until the authenticated viewer is available", () => {
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useModelsQuery({ viewer: undefined }), { wrapper });

      expect(result.current.fetchStatus).toBe("idle");
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe("useModelTargetsQuery", () => {
    it("fetches /dashboard/models/targets", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        data: [{ id: "openai:gpt-4", name: "GPT-4", provider: "openai" }],
      });
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useModelTargetsQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith("/dashboard/models/targets");
    });
  });
});
