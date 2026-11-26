import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type {
  LocalPluginItem,
  RegisterLocalPluginInput,
  RegisterMcpInput,
  SourceItem,
  UploadPluginInput,
} from "../types";

export const SOURCES_QUERY_KEY = ["sources"] as const;
export const LOCAL_PLUGINS_QUERY_KEY = ["local-plugins"] as const;

export const useSources = (isAdmin: boolean) => {
  const queryClient = useQueryClient();

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["tools"] }),
    ]);
  };

  const sourcesQuery = useQuery({
    queryKey: SOURCES_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ sources: SourceItem[] }>("/v1/sources");

      return res.sources;
    },
  });

  const localPluginsQuery = useQuery({
    queryKey: LOCAL_PLUGINS_QUERY_KEY,
    enabled: isAdmin,
    queryFn: async () => {
      const res = await apiRequest<{ plugins: LocalPluginItem[] }>("/v1/sources/plugins/local");

      return res.plugins;
    },
  });

  const registerMcp = useMutation({
    mutationFn: (input: RegisterMcpInput) =>
      apiRequest("/v1/sources/mcp", { method: "POST", body: input }),
    onSuccess: invalidateAll,
  });

  const registerLocalPlugin = useMutation({
    mutationFn: (input: RegisterLocalPluginInput) =>
      apiRequest("/v1/sources/plugins/local", { method: "POST", body: input }),
    onSuccess: invalidateAll,
  });

  const uploadPlugin = useMutation({
    mutationFn: (input: UploadPluginInput) =>
      apiRequest("/v1/sources/plugins/upload", { method: "POST", body: input }),
    onSuccess: invalidateAll,
  });

  const syncSource = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/sources/${id}/sync`, { method: "POST", body: {} }),
    onSuccess: invalidateAll,
  });

  const toggleStatus = useMutation({
    mutationFn: (input: { id: string; status: "active" | "disabled" }) =>
      apiRequest(`/v1/sources/${input.id}`, {
        method: "PATCH",
        body: { status: input.status },
      }),
    onSuccess: invalidateAll,
  });

  const deleteSource = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/sources/${id}`, { method: "DELETE" }),
    onSuccess: invalidateAll,
  });

  return {
    sources: sourcesQuery.data ?? [],
    isLoading: sourcesQuery.isPending,
    localPlugins: localPluginsQuery.data ?? [],
    registerMcp,
    registerLocalPlugin,
    uploadPlugin,
    syncSource,
    toggleStatus,
    deleteSource,
  };
};
