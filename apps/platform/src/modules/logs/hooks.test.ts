import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../lib/api-client";
import { useLogsQuery, useLogsStatsQuery } from "./hooks";

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("logs hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("useLogsQuery", () => {
    it("fetches /logs with query params", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({ logs: [], total: 0 });
      const { result } = renderHook(
        () => useLogsQuery({ provider: "openai", model: "gpt-4", limit: 10, offset: 0 }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/logs?"));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("provider=openai"));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("model=gpt-4"));
    });
  });

  describe("useLogsStatsQuery", () => {
    it("fetches /logs/stats", async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce({
        totalRequests: 100,
        totalTokens: 5000,
        totalCost: 2.5,
        byProvider: [],
        byModel: [],
        daily: [],
      });
      const { result } = renderHook(
        () => useLogsStatsQuery({ days: 30, provider: "openai", model: "gpt-4" }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/logs/stats?"));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("days=30"));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("provider=openai"));
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("model=gpt-4"));
    });
  });
});
