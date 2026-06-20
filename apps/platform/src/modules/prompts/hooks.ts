import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export type PromptVersion = {
  id: string;
  promptId: string;
  version: number;
  content: string;
  model: string | null;
  temperature: number | null;
  notes: string | null;
  createdAt: string;
  creator?: { email: string };
};

export type Prompt = {
  id: string;
  name: string;
  description: string | null;
  activeVersionId: string | null;
  activeVersion: { id: string; version: number; model: string | null } | null;
  versions?: PromptVersion[];
  creator?: { email: string };
  _count?: { versions: number };
  createdAt: string;
  updatedAt: string;
};

const queryKey = ["prompts"] as const;

export function usePromptsQuery() {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ prompts: Prompt[] }>("/prompts"),
  });
}

export function usePromptQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKey, id] as const,
    enabled: Boolean(id),
    queryFn: () => apiFetch<{ prompt: Prompt }>(`/prompts/${id}`),
  });
}

export function useCreatePromptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      description?: string;
      content: string;
      model?: string;
      temperature?: number;
      notes?: string;
    }) => apiFetch<{ prompt: Prompt }>("/prompts", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useCreateVersionMutation(promptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      content: string;
      model?: string;
      temperature?: number;
      notes?: string;
    }) =>
      apiFetch<{ version: PromptVersion }>(`/prompts/${promptId}/versions`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useSetActiveVersionMutation(promptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      apiFetch<{ prompt: Prompt }>(`/prompts/${promptId}/active`, {
        method: "POST",
        body: { versionId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}
