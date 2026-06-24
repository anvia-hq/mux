import { z } from "zod";

/**
 * Zod schemas for the OpenAI Responses API create request.
 *
 * Phase 0 ships only the `model` and `input` fields; later plan items
 * (P1.1, P1.2, etc.) extend the schema with the rest of the spec.
 */

const inputTextSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

const inputMessageSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "system", "assistant", "developer"]),
  content: z.array(inputTextSchema).min(1),
  status: z.enum(["in_progress", "completed", "incomplete"]).optional(),
});

export const responseInputSchema = z.union([
  z.string().min(1),
  z.array(inputMessageSchema).min(1),
]);

// --- Tool schemas (P1.2) ---

const functionToolSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

const webSearchToolSchema = z.object({
  type: z.literal("web_search"),
  filters: z.object({ allowed_domains: z.array(z.string()).optional() }).optional(),
  search_context_size: z.enum(["low", "medium", "high"]).optional(),
  user_location: z
    .object({
      type: z.literal("approximate"),
      city: z.string().optional(),
      country: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
});

const fileSearchToolSchema = z.object({
  type: z.literal("file_search"),
  vector_store_ids: z.array(z.string()).min(1),
  filters: z.unknown().optional(),
  max_num_results: z.number().int().positive().optional(),
  ranking: z
    .object({
      ranker: z.string().optional(),
      score_threshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

const codeInterpreterToolSchema = z.object({
  type: z.literal("code_interpreter"),
  container: z
    .union([
      z.object({ type: z.literal("auto") }),
      z.object({ type: z.literal("local") }),
      z.string(),
    ])
    .optional(),
});

const mcpToolSchema = z.object({
  type: z.literal("mcp"),
  server_label: z.string().min(1),
  server_url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  require_approval: z
    .union([
      z.boolean(),
      z.object({ never: z.object({ tool_names: z.array(z.string()) }).optional() }),
    ])
    .optional(),
  allowed_tools: z
    .union([z.array(z.string()), z.object({ tool_names: z.array(z.string()) })])
    .optional(),
});

const customToolSchema = z.object({
  type: z.literal("custom"),
  name: z.string().min(1),
  description: z.string().optional(),
});

const applyPatchToolSchema = z.object({ type: z.literal("apply_patch") });

export const responseToolSchema = z.discriminatedUnion("type", [
  functionToolSchema,
  webSearchToolSchema,
  fileSearchToolSchema,
  codeInterpreterToolSchema,
  mcpToolSchema,
  customToolSchema,
  applyPatchToolSchema,
]);

// --- tool_choice (P1.3) ---

const hostedToolChoiceSchema = z.object({
  type: z.enum([
    "web_search",
    "file_search",
    "code_interpreter",
    "mcp",
    "custom",
    "apply_patch",
  ]),
  name: z.string().optional(),
});

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) }),
  hostedToolChoiceSchema,
]);

// --- text.format (P1.5) ---

const textFormatSchema = z.union([
  z.object({ type: z.literal("text") }),
  z.object({ type: z.literal("json_object") }),
  z.object({
    type: z.literal("json_schema"),
    name: z.string().min(1),
    description: z.string().optional(),
    schema: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional(),
  }),
]);

export const responseCreateRequestSchema = z
  .object({
  model: z
    .string({ error: "model is required" })
    .min(1, "model is required"),
  input: responseInputSchema.optional(),
  instructions: z.string().optional(),
  stream: z.boolean().optional(),
  background: z.boolean().optional(),
  tools: z.array(responseToolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  text: z.object({ format: textFormatSchema }).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  store: z.boolean().optional(),
  service_tier: z.enum(["auto", "default", "flex", "priority"]).optional(),
  safety_identifier: z.string().min(1).max(64).optional(),
  truncation: z.enum(["auto", "disabled"]).optional(),
  prompt: z
    .union([
      z.string(),
      z.object({
        id: z.string(),
        version: z.string().optional(),
        variables: z.record(z.string(), z.string()).optional(),
      }),
    ])
    .optional(),
  reasoning: z
    .object({
      effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
      summary: z.enum(["auto", "concise", "detailed"]).optional(),
    })
    .optional(),
}).refine((data) => !(data.stream === true && data.background === true), {
  message: "stream and background cannot both be true",
  path: ["background"],
});

export type ResponseCreateRequestInput = z.infer<typeof responseCreateRequestSchema>;

// --- Compact schema (P4.3) ---

const responseCompactInputSchema = z.union([
  z.string().min(1),
  z.array(z.record(z.string(), z.unknown())).min(1),
]);

export const responseCompactRequestSchema = z
  .object({
    model: z
      .string({ error: "model is required" })
      .min(1, "model is required"),
    input: responseCompactInputSchema.optional(),
  })
  .strict();

export type ResponseCompactRequestInput = z.infer<typeof responseCompactRequestSchema>;
