import { z } from "zod";
import type { ToolCachePolicy } from "../types";

export const toolCachePolicySchema = z.object({
  mode: z.enum(["off", "ttl", "stale_while_revalidate"]).default("off"),
  ttlSeconds: z.number().int().min(1).max(86_400).default(60),
  staleSeconds: z.number().int().min(0).max(86_400).optional(),
  maxPayloadBytes: z.number().int().min(1024).max(10_485_760).optional(),
  tags: z.array(z.string().min(1).max(128)).max(20).optional(),
  allowBypass: z.boolean().default(true),
});

export const createDefaultCachePolicy = (): ToolCachePolicy => ({
  mode: "off",
  ttlSeconds: 60,
  allowBypass: true,
});
