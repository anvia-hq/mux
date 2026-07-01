import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../../src/lib/api-client";
import {
  useCreateModelAliasMutation,
  useDeleteModelAliasMutation,
  useModelAliasesQuery,
  useUpdateModelAliasMutation,
} from "../../../src/modules/model-aliases/hooks";

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
  description: "Stable chat alias",
  targetModelId: "openai:gpt-4o",
  enabled: true,
};

describe("model aliases hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches model aliases", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ data: [] });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useModelAliasesQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/model-aliases");
  });

  it("creates aliases and invalidates dependent queries", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ alias: { id: "fast-chat" } });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useCreateModelAliasMutation(), { wrapper });
    await act(() => result.current.mutateAsync(input));

    expect(apiFetch).toHaveBeenCalledWith("/model-aliases", {
      method: "POST",
      body: input,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["model-aliases"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });

  it("updates aliases without sending id in the body", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ alias: { id: "fast-chat" } });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useUpdateModelAliasMutation(), { wrapper });
    await act(() => result.current.mutateAsync(input));

    expect(apiFetch).toHaveBeenCalledWith("/model-aliases/fast-chat", {
      method: "PUT",
      body: {
        name: input.name,
        description: input.description,
        targetModelId: input.targetModelId,
        enabled: input.enabled,
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["model-aliases"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });

  it("deletes aliases and invalidates dependent queries", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useDeleteModelAliasMutation(), { wrapper });
    await act(() => result.current.mutateAsync("fast-chat"));

    expect(apiFetch).toHaveBeenCalledWith("/model-aliases/fast-chat", { method: "DELETE" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["model-aliases"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "models"] });
  });
});
