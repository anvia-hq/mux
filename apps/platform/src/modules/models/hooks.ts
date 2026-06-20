import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export type Model = { id: string; object: string; created: number; owned_by: string };

export function useModelsQuery() {
  return useQuery({
    queryKey: ["v1", "models"] as const,
    queryFn: () => apiFetch<{ data: Model[] }>("/v1/models"),
  });
}

export function groupByProvider(models: Model[] | undefined) {
  const groups = new Map<string, Model[]>();
  for (const m of models ?? []) {
    const list = groups.get(m.owned_by) ?? [];
    list.push(m);
    groups.set(m.owned_by, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}
