import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";

export type ApiKey = {
  id: string;
  name: string;
  createdBy: string;
  isActive: boolean;
  spendLimitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  allowAllModels: boolean;
  includeFutureModels: boolean;
  allowedModelIds: string[] | null;
  canReveal: boolean;
  createdAt: string;
  creator: { email: string };
};

export type CreateApiKeyInput = {
  name: string;
  spendLimitUsd?: number | null;
  allowedModelIds?: string[] | null;
  includeFutureModels?: boolean;
};

export type UpdateApiKeyModelAccessInput =
  | {
      mode: "snapshot";
    }
  | {
      mode: "selected";
      allowedModelIds: string[];
    }
  | {
      mode: "future";
    };

export type UpdateApiKeyModelAccessVariables = UpdateApiKeyModelAccessInput & {
  id: string;
};

const queryKey = ["api-keys"] as const;

export function useApiKeysQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ keys: ApiKey[] }>("/api-keys"),
    enabled: options.enabled,
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

export function useRevealApiKeyMutation() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ key: string }>(`/api-keys/${id}/reveal`),
  });
}

export function useRotateApiKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ key: string }>(`/api-keys/${id}/rotate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useUpdateApiKeyModelAccessMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateApiKeyModelAccessVariables) =>
      apiFetch<{ ok: true }>(`/api-keys/${id}/model-access`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
