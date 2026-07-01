import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../../src/lib/api-client";
import { useModelTargetsQuery, useModelsQuery } from "../../../src/modules/models/hooks";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("models hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("useModelsQuery", () => {
    it("fetches /dashboard/models", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        data: [{ id: "gpt-4", name: "GPT-4", provider: "openai" }],
      });
      const { result } = renderHook(() => useModelsQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith("/dashboard/models");
    });
  });

  describe("useModelTargetsQuery", () => {
    it("fetches /dashboard/models/targets", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        data: [{ id: "openai:gpt-4", name: "GPT-4", provider: "openai" }],
      });
      const { result } = renderHook(() => useModelTargetsQuery(), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith("/dashboard/models/targets");
    });
  });
});
