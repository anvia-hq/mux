import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";

export type ApiKey = {
  id: string;
  name: string;
  isActive: boolean;
  spendLimitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  allowAllModels: boolean;
  allowedModelIds: string[] | null;
  createdAt: string;
  creator: { email: string };
};

export type CreateApiKeyInput = {
  name: string;
  spendLimitUsd?: number | null;
  allowedModelIds?: string[] | null;
};

const queryKey = ["api-keys"] as const;

export function useApiKeysQuery() {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ keys: ApiKey[] }>("/api-keys"),
  });
}

export function useCreateApiKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      apiFetch<{ id: string; key: string }>("/api-keys", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useRevokeApiKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
