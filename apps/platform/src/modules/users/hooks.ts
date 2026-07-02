import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";
import type { AuthUser } from "../auth/types";

export type DashboardUser = AuthUser;

const queryKey = ["users"] as const;

export function useUsersQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ users: DashboardUser[] }>("/users"),
    enabled: options.enabled,
  });
}

export function usePromoteUserMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ user: DashboardUser }>(`/users/${id}/promote`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
