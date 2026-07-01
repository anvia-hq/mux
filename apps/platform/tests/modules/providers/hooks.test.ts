import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("../../../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../../../src/lib/api-client";
import {
  useCreateCustomProviderMutation,
  useDeleteCustomProviderMutation,
  useProviderCatalogQuery,
  useProvidersQuery,
  useReplaceCustomProviderModelsMutation,
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

  it("useProviderCatalogQuery fetches /providers/catalog", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      providers: [{ provider: "custom-openai", name: "Custom", type: "custom" }],
    });
    const { result } = renderHook(() => useProviderCatalogQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/providers/catalog");
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

  it("useCreateCustomProviderMutation posts custom provider payloads", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ provider: { provider: "custom-openai" } });
    const { result } = renderHook(() => useCreateCustomProviderMutation(), { wrapper });
    const input = {
      id: "custom-openai",
      name: "Custom OpenAI",
      apiBase: "https://custom.example/v1",
      apiKey: "custom-key",
      models: [
        {
          id: "custom-chat",
          name: "Custom Chat",
          inputPricePer1M: 1,
          outputPricePer1M: 2,
          contextWindow: 128000,
          maxOutputTokens: 4096,
          inputModalities: ["text"],
          outputModalities: ["text"],
          reasoning: false,
          toolCall: true,
          structuredOutput: true,
          weights: "closed" as const,
        },
      ],
    };
    await act(() => result.current.mutateAsync(input));
    expect(apiFetch).toHaveBeenCalledWith("/providers/custom", {
      method: "POST",
      body: input,
    });
  });

  it("useDeleteCustomProviderMutation deletes custom providers", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useDeleteCustomProviderMutation(), { wrapper });
    await act(() => result.current.mutateAsync("custom-openai"));
    expect(apiFetch).toHaveBeenCalledWith("/providers/custom/custom-openai", {
      method: "DELETE",
    });
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

  it("useReplaceCustomProviderModelsMutation replaces models", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useReplaceCustomProviderModelsMutation("custom-openai"), {
      wrapper,
    });
    const models = [
      {
        id: "custom-chat",
        name: "Custom Chat",
        inputPricePer1M: 1,
        outputPricePer1M: 2,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputModalities: ["text"],
        outputModalities: ["text"],
        reasoning: false,
        toolCall: true,
        structuredOutput: true,
        weights: "closed" as const,
      },
    ];
    await act(() => result.current.mutateAsync(models));
    expect(apiFetch).toHaveBeenCalledWith("/providers/custom-openai/models", {
      method: "PUT",
      body: { models },
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
