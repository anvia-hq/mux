import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";
import type { AuthUser } from "../auth/types";

export interface Model {
  id: string;
  name: string;
  provider: string;
  type?: "provider" | "fallback-group" | "alias";
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
  aliasTargetModelId?: string;
}

type ModelsQueryOptions = {
  enabled?: boolean;
  viewer: Pick<AuthUser, "id" | "role"> | undefined;
};

export function useModelsQuery(options: ModelsQueryOptions) {
  return useQuery({
    queryKey: ["dashboard", "models", options.viewer?.id, options.viewer?.role] as const,
    queryFn: () => apiFetch<{ data: Model[] }>("/dashboard/models"),
    enabled: Boolean(options.viewer) && (options.enabled ?? true),
  });
}

export function useModelTargetsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["dashboard", "model-targets"] as const,
    queryFn: () => apiFetch<{ data: Model[] }>("/dashboard/models/targets"),
    enabled: options.enabled ?? true,
  });
}
