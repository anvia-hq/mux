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

export const responseCreateRequestSchema = z.object({
  model: z
    .string({ error: "model is required" })
    .min(1, "model is required"),
  input: responseInputSchema.optional(),
  instructions: z.string().optional(),
  stream: z.boolean().optional(),
  background: z.boolean().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z
    .union([
      z.enum(["none", "auto", "required"]),
      z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) }),
    ])
    .optional(),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  store: z.boolean().optional(),
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
});

export type ResponseCreateRequestInput = z.infer<typeof responseCreateRequestSchema>;
