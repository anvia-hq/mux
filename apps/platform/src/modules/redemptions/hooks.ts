import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";

export type RedemptionStatus = "active" | "disabled" | "used" | "expired";
export type RedemptionTargetType = "USER" | "API_KEY";

export type Redemption = {
  id: string;
  codeLastFour: string;
  name: string;
  amountUsd: number;
  status: RedemptionStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { email: string };
  application: {
    targetType: RedemptionTargetType;
    createdAt: string;
    applier: { email: string };
    user: { id: string; email: string } | null;
    apiKey: { id: string; name: string; creator: { email: string } } | null;
  } | null;
};

export type CreateRedemptionInput = {
  name: string;
  amountUsd: number;
  count?: number;
  expiresAt?: string | null;
};

export type UpdateRedemptionInput = {
  id: string;
  name?: string;
  amountUsd?: number;
  status?: "ACTIVE" | "DISABLED";
  expiresAt?: string | null;
};

export type ApplyRedemptionInput = {
  id: string;
  targetType: RedemptionTargetType;
  targetId: string;
};

export type CreateRedemptionResponse = {
  redemptions: Array<Redemption & { code: string }>;
};

const queryKey = ["redemptions"] as const;

export function useRedemptionsQuery() {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ redemptions: Redemption[] }>("/redemptions"),
  });
}

export function useCreateRedemptionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRedemptionInput) =>
      apiFetch<CreateRedemptionResponse>("/redemptions", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useUpdateRedemptionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRedemptionInput) =>
      apiFetch<{ redemption: Redemption }>(`/redemptions/${id}`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useDeleteRedemptionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/redemptions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useApplyRedemptionMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: ApplyRedemptionInput) =>
      apiFetch<{ redemption: Redemption }>(`/redemptions/${id}/apply`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
