import type { z } from "zod";
import type {
  applyRedemptionSchema,
  createRedemptionSchema,
  redeemRedemptionSchema,
  updateRedemptionSchema,
} from "./schema";

export type CreateRedemptionInput = z.infer<typeof createRedemptionSchema>;
export type UpdateRedemptionInput = z.infer<typeof updateRedemptionSchema>;
export type ApplyRedemptionInput = z.infer<typeof applyRedemptionSchema>;
export type RedeemRedemptionInput = z.infer<typeof redeemRedemptionSchema>;

export type RedemptionStatus = "active" | "disabled" | "used" | "expired";
export type RedemptionTargetType = "USER" | "API_KEY";

export type RedemptionSummary = {
  id: string;
  codeLastFour: string;
  name: string;
  amountUsd: number;
  status: RedemptionStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { email: string };
  application: {
    targetType: RedemptionTargetType;
    createdAt: Date;
    applier: { email: string };
    user: { id: string; email: string } | null;
    apiKey: { id: string; name: string; creator: { email: string } } | null;
  } | null;
};

export type RedemptionCreateResponse = {
  redemptions: Array<RedemptionSummary & { code: string }>;
};
