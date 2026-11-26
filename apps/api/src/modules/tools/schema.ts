import { toolCachePolicySchema } from "@mux/core/cache/schema";
import { z } from "zod";

export const toolIdParamSchema = z.object({
  id: z.uuid(),
});

export const listToolsQuerySchema = z.object({
  sourceId: z.uuid().optional(),
});

export const updateToolBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    cachePolicy: toolCachePolicySchema.optional(),
  })
  .refine((data) => data.enabled !== undefined || data.cachePolicy !== undefined, {
    message: "At least one field must be provided for update.",
  });

export const invalidateTagBodySchema = z.object({
  tag: z.string().trim().min(1).max(128),
});
