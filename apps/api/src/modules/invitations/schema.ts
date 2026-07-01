import { z } from "zod";

export const createInvitationSchema = z.object({
  balanceUsd: z
    .number({ error: "balanceUsd must be a number" })
    .positive("balanceUsd must be greater than 0")
    .nullable()
    .optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
