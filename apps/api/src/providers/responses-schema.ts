import { z } from "zod";

/**
 * Zod schemas for the OpenAI Responses API create request.
 */

export const responseInputSchema = z.unknown();

function optionalNullable<T>(schema: z.ZodType<T>) {
  return schema.nullish().transform((value) => value ?? undefined);
}

function omitUndefinedValues<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T;
}

const streamOptionsSchema = z
  .object({
    include_usage: z.boolean().optional(),
    include_obfuscation: z.boolean().optional(),
  })
  .catchall(z.unknown());

export const responseCreateRequestSchema = z
  .object({
    model: z.string({ error: "model is required" }).min(1, "model is required"),
    input: responseInputSchema.optional(),
    include: z.unknown().optional(),
    conversation: z.unknown().optional(),
    context_management: z.unknown().optional(),
    enable_thinking: z.unknown().optional(),
    instructions: z.unknown().optional(),
    stream: optionalNullable(z.boolean()),
    stream_options: optionalNullable(streamOptionsSchema),
    background: optionalNullable(z.boolean()),
    tools: z.unknown().optional(),
    tool_choice: z.unknown().optional(),
    text: z.unknown().optional(),
    max_output_tokens: optionalNullable(z.number().int().nonnegative()),
    max_tool_calls: optionalNullable(z.number().int().nonnegative()),
    temperature: optionalNullable(z.number()),
    metadata: z.unknown().optional(),
    parallel_tool_calls: z.unknown().optional(),
    previous_response_id: optionalNullable(z.string()),
    store: z.unknown().optional(),
    service_tier: optionalNullable(z.string()),
    safety_identifier: z.unknown().optional(),
    truncation: z.unknown().optional(),
    prompt: z.unknown().optional(),
    prompt_cache_key: z.unknown().optional(),
    prompt_cache_retention: z.unknown().optional(),
    reasoning: optionalNullable(
      z
        .object({
          effort: z.string().optional(),
          summary: z.string().optional(),
        })
        .catchall(z.unknown()),
    ),
    top_logprobs: optionalNullable(z.number().int()),
    top_p: optionalNullable(z.number()),
    preset: z.unknown().optional(),
    user: z.unknown().optional(),
  })
  .refine((data) => Object.hasOwn(data, "input"), {
    message: "input is required",
    path: ["input"],
  })
  .refine((data) => !(data.stream === true && data.background === true), {
    message: "stream and background cannot both be true",
    path: ["background"],
  })
  .transform(omitUndefinedValues);

export type ResponseCreateRequestInput = z.infer<typeof responseCreateRequestSchema>;

// --- Compact schema (P4.3) ---

export const responseCompactRequestSchema = z
  .object({
    model: z.string({ error: "model is required" }).min(1, "model is required"),
    input: z.unknown().optional(),
    instructions: z.unknown().optional(),
    previous_response_id: optionalNullable(z.string()),
  })
  .transform(omitUndefinedValues);

export type ResponseCompactRequestInput = z.infer<typeof responseCompactRequestSchema>;
