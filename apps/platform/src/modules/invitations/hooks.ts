import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../../lib/api-client";

export type InvitationStatus = "pending" | "redeemed" | "revoked";

export type Invitation = {
  id: string;
  codeLastFour: string;
  balanceUsd: number | null;
  isActive: boolean;
  status: InvitationStatus;
  createdAt: string;
  updatedAt: string;
  redeemedAt: string | null;
  creator: { email: string };
  redeemer: { email: string } | null;
};

export type CreateInvitationInput = {
  balanceUsd?: number | null;
};

export type CreateInvitationResponse = {
  invitation: Invitation;
  code: string;
};

const queryKey = ["invitations"] as const;

export function useInvitationsQuery() {
  return useQuery({
    queryKey,
    queryFn: () => apiFetch<{ invitations: Invitation[] }>("/invitations"),
  });
}

export function useCreateInvitationMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      apiFetch<CreateInvitationResponse>("/invitations", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useRevokeInvitationMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function isForbiddenError(err: unknown) {
  return err instanceof ApiError && err.status === 403;
}
