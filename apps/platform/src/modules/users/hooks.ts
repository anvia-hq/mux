import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";
import type { AuthUser } from "../auth/types";

export type DashboardUser = AuthUser;

const queryKey = ["users"] as const;

export function useUsersQuery() {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ users: DashboardUser[] }>("/users"),
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
