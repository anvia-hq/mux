import { assertSafeUpstreamUrl, isReservedMcpHeader } from "@mux/mcp/upstream-client";
import { z } from "zod";

const SOURCE_SLUG_PATTERN = /^(?!.*__)[a-z][a-z0-9_-]{0,63}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const safeUpstreamUrlSchema = z.string().refine(
  (value) => {
    try {
      assertSafeUpstreamUrl(value);

      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid http/https upstream URL without credentials or metadata hosts." },
);

const safeHeadersSchema = z.record(
  z
    .string()
    .regex(HEADER_NAME_PATTERN, "Invalid HTTP header name.")
    .refine((name) => !isReservedMcpHeader(name), {
      message: "Reserved HTTP/MCP transport headers cannot be configured.",
    }),
  z.string().refine((val) => !/[\r\n]/.test(val), "Header values cannot contain newlines."),
);

export const sourceIdParamSchema = z.object({
  id: z.uuid(),
});

export const createMcpSourceBodySchema = z.object({
  slug: z
    .string()
    .regex(SOURCE_SLUG_PATTERN, "Source slug must be lowercase without double underscores."),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  url: safeUpstreamUrlSchema,
  transport: z.literal("streamable_http").default("streamable_http"),
  timeoutMs: z.number().int().min(500).max(60_000).optional(),
  headers: safeHeadersSchema.optional(),
  autoSync: z.boolean().default(true),
});

export const updateSourceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
    url: safeUpstreamUrlSchema.optional(),
    transport: z.literal("streamable_http").optional(),
    timeoutMs: z.number().int().min(500).max(60_000).optional(),
    headers: safeHeadersSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.status !== undefined ||
      data.url !== undefined ||
      data.transport !== undefined ||
      data.timeoutMs !== undefined ||
      data.headers !== undefined,
    { message: "At least one field must be provided for update." },
  );
