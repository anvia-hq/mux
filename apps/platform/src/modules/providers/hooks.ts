import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";
import type { Model } from "../models/hooks";

export type ProviderRow = {
  provider: string;
  lastFour: string;
  updatedAt: string;
  updater?: { email: string };
};

export const PROVIDER_NAMES = ["openai", "anthropic", "google", "mistral"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI",
  mistral: "Mistral",
};

const providersKey = ["providers"] as const;

export function useProvidersQuery() {
  return useQuery({
    queryKey: providersKey,
    queryFn: () => apiFetch<{ providers: ProviderRow[] }>("/providers"),
  });
}

export function useSetProviderKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: ProviderName; apiKey: string }) =>
      apiFetch<{ provider: ProviderRow }>(`/providers/${input.provider}`, {
        method: "PUT",
        body: { apiKey: input.apiKey },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: providersKey }),
  });
}

export function useDeleteProviderKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: ProviderName) =>
      apiFetch<{ ok: true }>(`/providers/${provider}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: providersKey }),
  });
}

export type ProviderModel = Model & { enabled: boolean };

export function useProviderModelsQuery(provider: ProviderName) {
  return useQuery({
    queryKey: ["providers", provider, "models"],
    queryFn: () => apiFetch<{ data: ProviderModel[] }>(`/providers/${provider}/models`),
  });
}

export function useToggleModelMutation(provider: ProviderName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { modelId: string; enabled: boolean }) =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/toggle`, {
        method: "PUT",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers", provider, "models"] }),
  });
}

export function useEnableAllMutation(provider: ProviderName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/enable-all`, {
        method: "PUT",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers", provider, "models"] }),
  });
}

export function useDisableAllMutation(provider: ProviderName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/disable-all`, {
        method: "PUT",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers", provider, "models"] }),
  });
}
