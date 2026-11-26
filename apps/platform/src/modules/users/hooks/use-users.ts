import type { UserRole } from "@mux/core/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { SESSION_QUERY_KEY } from "@/modules/auth/hooks/use-session";
import type { WorkspaceUserItem } from "../types";

export const USERS_QUERY_KEY = ["users"] as const;

export const useUsers = () => {
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ users: WorkspaceUserItem[] }>("/v1/users");

      return res.users;
    },
  });

  const updateRole = useMutation({
    mutationFn: (input: { id: string; role: UserRole }) =>
      apiRequest(`/v1/users/${input.id}/role`, {
        method: "PATCH",
        body: { role: input.role },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
      ]);
    },
  });

  return {
    users: usersQuery.data ?? [],
    isLoading: usersQuery.isPending,
    error: usersQuery.error,
    updateRole,
  };
};
