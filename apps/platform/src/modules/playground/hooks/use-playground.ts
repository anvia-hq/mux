import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { ExecutionLogItem, PlaygroundExecuteInput, PlaygroundExecuteOutput } from "../types";

export const EXECUTIONS_QUERY_KEY = ["executions"] as const;

export const useExecutions = (limit = 50) =>
  useQuery({
    queryKey: [...EXECUTIONS_QUERY_KEY, limit],
    queryFn: async () => {
      const res = await apiRequest<{ executions: ExecutionLogItem[] }>(
        `/v1/executions?limit=${limit}`,
      );

      return res.executions;
    },
  });

export const usePlaygroundExecute = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ toolId, ...body }: PlaygroundExecuteInput) =>
      apiRequest<PlaygroundExecuteOutput>(`/v1/tools/${toolId}/execute`, {
        method: "POST",
        body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: EXECUTIONS_QUERY_KEY });
    },
  });
};
