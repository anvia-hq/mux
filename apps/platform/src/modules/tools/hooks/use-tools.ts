import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { ToolItem, UpdateToolInput } from "../types";

export const TOOLS_QUERY_KEY = ["tools"] as const;

export const useTools = () => {
  const queryClient = useQueryClient();

  const toolsQuery = useQuery({
    queryKey: TOOLS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ tools: ToolItem[] }>("/v1/tools");

      return res.tools;
    },
  });

  const updateTool = useMutation({
    mutationFn: ({ id, ...body }: UpdateToolInput) =>
      apiRequest<{ tool: ToolItem }>(`/v1/tools/${id}`, { method: "PATCH", body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TOOLS_QUERY_KEY });
    },
  });

  const invalidateToolCache = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ deleted: number }>(`/v1/tools/${id}/cache/invalidate`, {
        method: "POST",
        body: {},
      }),
  });

  const invalidateTagCache = useMutation({
    mutationFn: (tag: string) =>
      apiRequest<{ deleted: number }>("/v1/tools/cache/invalidate-tag", {
        method: "POST",
        body: { tag },
      }),
  });

  return {
    tools: toolsQuery.data ?? [],
    isLoading: toolsQuery.isPending,
    updateTool,
    invalidateToolCache,
    invalidateTagCache,
  };
};
