import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export type ModelAlias = {
  id: string;
  name: string;
  description: string | null;
  targetModelId: string;
  targetAvailable: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModelAliasInput = {
  id: string;
  name: string;
  description?: string | null;
  targetModelId: string;
  enabled: boolean;
};

const modelAliasesKey = ["model-aliases"] as const;

export function useModelAliasesQuery() {
  return useQuery({
    queryKey: modelAliasesKey,
    queryFn: () => apiFetch<{ data: ModelAlias[] }>("/model-aliases"),
  });
}

export function useCreateModelAliasMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModelAliasInput) =>
      apiFetch<{ alias: ModelAlias }>("/model-aliases", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: modelAliasesKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}

export function useUpdateModelAliasMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModelAliasInput) =>
      apiFetch<{ alias: ModelAlias }>(`/model-aliases/${input.id}`, {
        method: "PUT",
        body: {
          name: input.name,
          description: input.description,
          targetModelId: input.targetModelId,
          enabled: input.enabled,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: modelAliasesKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}

export function useDeleteModelAliasMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/model-aliases/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: modelAliasesKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
    },
  });
}
