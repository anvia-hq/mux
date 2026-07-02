import { z } from "zod";

const amountUsdSchema = z
  .number({ error: "amountUsd must be a number" })
  .positive("amountUsd must be greater than 0");

const nullableDateTimeSchema = z
  .string({ error: "expiresAt must be an ISO datetime" })
  .datetime("expiresAt must be an ISO datetime")
  .nullable()
  .optional();

export const createRedemptionSchema = z.object({
  name: z.string({ error: "name is required" }).trim().min(1, "name is required"),
  amountUsd: amountUsdSchema,
  count: z
    .number({ error: "count must be a number" })
    .int("count must be an integer")
    .min(1, "count must be at least 1")
    .max(100, "count must be at most 100")
    .optional(),
  expiresAt: nullableDateTimeSchema,
});

export const updateRedemptionSchema = z
  .object({
    name: z.string({ error: "name must be a string" }).trim().min(1, "name is required").optional(),
    amountUsd: amountUsdSchema.optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    expiresAt: nullableDateTimeSchema,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const applyRedemptionSchema = z.object({
  targetType: z.enum(["USER", "API_KEY"]),
  targetId: z.string({ error: "targetId is required" }).trim().min(1, "targetId is required"),
});

export const redeemRedemptionSchema = z.object({
  code: z.string({ error: "code is required" }).trim().min(1, "code is required"),
});
