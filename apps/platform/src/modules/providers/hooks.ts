import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

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
