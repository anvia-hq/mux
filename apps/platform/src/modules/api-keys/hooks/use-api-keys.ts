import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { ApiKeyItem, CreateApiKeyInput, CreatedApiKeyResponse } from "../types";

export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

export const useApiKeys = () => {
  const queryClient = useQueryClient();

  const keysQuery = useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ apiKeys: ApiKeyItem[] }>("/v1/api-keys");

      return res.apiKeys;
    },
  });

  const createKey = useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      apiRequest<CreatedApiKeyResponse>("/v1/api-keys", { method: "POST", body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
    },
  });

  return {
    apiKeys: keysQuery.data ?? [],
    isLoading: keysQuery.isPending,
    error: keysQuery.error,
    createKey,
    revokeKey,
  };
};
