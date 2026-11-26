import { z } from "zod";

export const apiKeyIdParamSchema = z.object({
  id: z.uuid(),
});

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  endpointId: z.uuid().nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
});
