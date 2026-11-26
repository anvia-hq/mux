import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { CreateEndpointInput, EndpointItem, EndpointToolBinding } from "../types";

export const ENDPOINTS_QUERY_KEY = ["endpoints"] as const;

export const useEndpoints = (selectedEndpointId: string | null) => {
  const queryClient = useQueryClient();

  const endpointsQuery = useQuery({
    queryKey: ENDPOINTS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ endpoints: EndpointItem[] }>("/v1/endpoints");

      return res.endpoints;
    },
  });

  const bindingsQuery = useQuery({
    queryKey: ["endpoint-tools", selectedEndpointId],
    enabled: selectedEndpointId !== null,
    queryFn: async () => {
      const res = await apiRequest<{ tools: EndpointToolBinding[] }>(
        `/v1/endpoints/${selectedEndpointId}/tools`,
      );

      return res.tools;
    },
  });

  const createEndpoint = useMutation({
    mutationFn: (input: CreateEndpointInput) =>
      apiRequest<{ endpoint: EndpointItem }>("/v1/endpoints", { method: "POST", body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ENDPOINTS_QUERY_KEY });
    },
  });

  const deleteEndpoint = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/endpoints/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ENDPOINTS_QUERY_KEY });
    },
  });

  const attachTool = useMutation({
    mutationFn: (input: { endpointId: string; toolId: string }) =>
      apiRequest(`/v1/endpoints/${input.endpointId}/tools/${input.toolId}`, {
        method: "PUT",
        body: { enabled: true },
      }),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["endpoint-tools", vars.endpointId] });
    },
  });

  const detachTool = useMutation({
    mutationFn: (input: { endpointId: string; toolId: string }) =>
      apiRequest(`/v1/endpoints/${input.endpointId}/tools/${input.toolId}`, {
        method: "DELETE",
      }),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["endpoint-tools", vars.endpointId] });
    },
  });

  return {
    endpoints: endpointsQuery.data ?? [],
    isLoading: endpointsQuery.isPending,
    bindings: bindingsQuery.data ?? [],
    createEndpoint,
    deleteEndpoint,
    attachTool,
    detachTool,
  };
};
