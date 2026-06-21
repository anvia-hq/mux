import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export type FallbackTarget = {
  provider: string;
  modelId: string;
  publicModelId: string;
  position: number;
};

export type FallbackGroup = {
  id: string;
  publicModelId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  targets: FallbackTarget[];
};

export type FallbackGroupInput = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  targets: { provider: string; modelId: string }[];
};

const fallbackGroupsKey = ["fallback-groups"] as const;

export function useFallbackGroupsQuery() {
  return useQuery({
    queryKey: fallbackGroupsKey,
    queryFn: () => apiFetch<{ data: FallbackGroup[] }>("/fallback-groups"),
  });
}

export function useCreateFallbackGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FallbackGroupInput) =>
      apiFetch<{ group: FallbackGroup }>("/fallback-groups", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fallbackGroupsKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}

export function useUpdateFallbackGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FallbackGroupInput) =>
      apiFetch<{ group: FallbackGroup }>(`/fallback-groups/${input.id}`, {
        method: "PUT",
        body: {
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          targets: input.targets,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fallbackGroupsKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}

export function useDeleteFallbackGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/fallback-groups/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fallbackGroupsKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}
