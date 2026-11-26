import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, apiRequest } from "@/lib/api-client";
import type { SessionUser, SignInInput, SignUpInput } from "../types";

export const SESSION_QUERY_KEY = ["session"] as const;

export const useSession = () => {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    retry: false,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const res = await apiRequest<{ user: SessionUser }>("/v1/users/me");

        return res.user;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          return null;
        }

        throw error;
      }
    },
  });

  const signInMutation = useMutation({
    mutationFn: async (input: SignInInput) =>
      apiRequest("/api/auth/sign-in/email", {
        method: "POST",
        body: input,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async (input: SignUpInput) =>
      apiRequest("/api/auth/sign-up/email", {
        method: "POST",
        body: input,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () =>
      apiRequest("/api/auth/sign-out", {
        method: "POST",
        body: {},
      }),
    onSuccess: async () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });

  return {
    user: sessionQuery.data ?? null,
    isLoading: sessionQuery.isPending,
    error: sessionQuery.error,
    refetch: sessionQuery.refetch,
    signIn: signInMutation,
    signUp: signUpMutation,
    signOut: signOutMutation,
  };
};
