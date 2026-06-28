import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../../src/lib/api-client";
import {
  useProvidersQuery,
  useSetProviderKeyMutation,
  useDeleteProviderKeyMutation,
  useProviderModelsQuery,
  useToggleModelMutation,
  useEnableAllMutation,
  useDisableAllMutation,
} from "../../../src/modules/providers/hooks";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

describe("providers hooks", () => {
  afterEach(() => vi.clearAllMocks());

  it("useProvidersQuery fetches /providers", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      providers: [{ provider: "openai", lastFour: "abcd" }],
    });
    const { result } = renderHook(() => useProvidersQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/providers");
  });

  it("useSetProviderKeyMutation puts to /providers/:name", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      provider: { provider: "openai", lastFour: "abcd" },
    });
    const { result } = renderHook(() => useSetProviderKeyMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ provider: "openai", apiKey: "sk-key" }));
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai", {
      method: "PUT",
      body: { apiKey: "sk-key" },
    });
  });

  it("useDeleteProviderKeyMutation deletes", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useDeleteProviderKeyMutation(), { wrapper });
    await act(() => result.current.mutateAsync("openai"));
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai", { method: "DELETE" });
  });

  it("useProviderModelsQuery fetches /providers/:name/models", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ data: [] });
    const { result } = renderHook(() => useProviderModelsQuery("openai"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai/models");
  });

  it("useToggleModelMutation toggles", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useToggleModelMutation("openai"), { wrapper });
    await act(() => result.current.mutateAsync({ modelId: "gpt-4", enabled: true }));
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai/models/toggle", {
      method: "PUT",
      body: { modelId: "gpt-4", enabled: true },
    });
  });

  it("useEnableAllMutation enables all", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useEnableAllMutation("openai"), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai/models/enable-all", { method: "PUT" });
  });

  it("useDisableAllMutation disables all", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useDisableAllMutation("openai"), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(apiFetch).toHaveBeenCalledWith("/providers/openai/models/disable-all", {
      method: "PUT",
    });
  });
});
