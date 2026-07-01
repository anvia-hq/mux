import type { z } from "zod";
import type { createInvitationSchema } from "./schema";

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export type InvitationStatus = "pending" | "redeemed" | "revoked";

export type InvitationSummary = {
  id: string;
  codeLastFour: string;
  balanceUsd: number | null;
  isActive: boolean;
  status: InvitationStatus;
  createdAt: Date;
  updatedAt: Date;
  redeemedAt: Date | null;
  creator: { email: string };
  redeemer: { email: string } | null;
};

export type InvitationCreateResponse = {
  invitation: InvitationSummary;
  code: string;
};
