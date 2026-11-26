import { z } from "zod";

export const executeToolParamSchema = z.object({
  id: z.uuid(),
});

export const executeToolBodySchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
  bypassCache: z.boolean().default(false),
});

export const listExecutionsQuerySchema = z.object({
  toolId: z.uuid().optional(),
  endpointId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
