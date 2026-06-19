import { z } from "zod";

/**
 * Validation schemas for the API keys admin endpoints.
 *
 * The `name` field is required, trimmed, and bounded to 100 characters so it
 * can be safely surfaced in the admin UI and database indexes without risk of
 * unbounded growth.
 */
export const createKeySchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, "name is required")
    .max(100, "name must be at most 100 characters"),
});

export type CreateKeyInput = z.infer<typeof createKeySchema>;
