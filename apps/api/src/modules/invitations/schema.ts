import { z } from "zod";

export const createInvitationSchema = z.object({
  balanceUsd: z
    .number({ error: "balanceUsd must be a number" })
    .positive("balanceUsd must be greater than 0")
    .nullable()
    .optional(),
  maxRedemptions: z
    .number({ error: "maxRedemptions must be a number" })
    .int("maxRedemptions must be an integer")
    .min(1, "maxRedemptions must be at least 1")
    .optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const updateInvitationSettingsSchema = z.object({
  inviteRegistrationEnabled: z.boolean({
    error: "inviteRegistrationEnabled must be a boolean",
  }),
});

export type UpdateInvitationSettingsInput = z.infer<typeof updateInvitationSettingsSchema>;
