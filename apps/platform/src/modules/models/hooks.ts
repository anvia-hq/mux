import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

export interface Model {
  id: string;
  name: string;
  provider: string;
  type?: "provider" | "fallback-group";
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  weights: "open" | "closed";
  fallbackTargets?: {
    provider: string;
    modelId: string;
    publicModelId: string;
    position: number;
  }[];
}

export function useModelsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["dashboard", "models"] as const,
    queryFn: () => apiFetch<{ data: Model[] }>("/dashboard/models"),
    enabled: options.enabled ?? true,
  });
}
