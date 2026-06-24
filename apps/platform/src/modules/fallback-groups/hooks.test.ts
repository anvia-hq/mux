import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../lib/api-client";
import {
  useCreateFallbackGroupMutation,
  useDeleteFallbackGroupMutation,
  useFallbackGroupsQuery,
  useUpdateFallbackGroupMutation,
} from "./hooks";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { wrapper, invalidateSpy };
}

const input = {
  id: "fast-chat",
  name: "Fast chat",
  description: "Primary then backup",
  enabled: true,
  targets: [{ provider: "openai", modelId: "gpt-4" }],
};

describe("fallback groups hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches fallback groups", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ data: [] });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useFallbackGroupsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/fallback-groups");
  });

  it("creates fallback groups and invalidates dependent queries", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ group: { id: "fast-chat" } });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useCreateFallbackGroupMutation(), { wrapper });
    await act(() => result.current.mutateAsync(input));

    expect(apiFetch).toHaveBeenCalledWith("/fallback-groups", {
      method: "POST",
      body: input,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["fallback-groups"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });

  it("updates fallback groups without sending id in the body", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ group: { id: "fast-chat" } });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useUpdateFallbackGroupMutation(), { wrapper });
    await act(() => result.current.mutateAsync(input));

    expect(apiFetch).toHaveBeenCalledWith("/fallback-groups/fast-chat", {
      method: "PUT",
      body: {
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        targets: input.targets,
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["fallback-groups"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });

  it("deletes fallback groups and invalidates dependent queries", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useDeleteFallbackGroupMutation(), { wrapper });
    await act(() => result.current.mutateAsync("fast-chat"));

    expect(apiFetch).toHaveBeenCalledWith("/fallback-groups/fast-chat", { method: "DELETE" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["fallback-groups"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });
});
