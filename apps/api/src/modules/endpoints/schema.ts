import { toolCachePolicySchema } from "@mux/core/cache/schema";
import { z } from "zod";

const ENDPOINT_SLUG_PATTERN = /^(?!.*__)[a-z][a-z0-9_-]{0,63}$/;

export const endpointIdParamSchema = z.object({
  id: z.uuid(),
});

export const endpointToolParamsSchema = z.object({
  id: z.uuid(),
  toolId: z.uuid(),
});

export const createEndpointBodySchema = z.object({
  slug: z
    .string()
    .regex(ENDPOINT_SLUG_PATTERN, "Endpoint slug must be lowercase without double underscores."),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  mode: z.enum(["direct", "router"]).default("direct"),
  enabled: z.boolean().default(true),
});

export const updateEndpointBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    mode: z.enum(["direct", "router"]).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.mode !== undefined ||
      data.enabled !== undefined,
    { message: "At least one field must be provided for update." },
  );

export const upsertEndpointToolBodySchema = z.object({
  enabled: z.boolean().default(true),
  cachePolicyOverride: toolCachePolicySchema.nullable().optional(),
});
