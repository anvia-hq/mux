import { z } from "zod";
import { normalizeName } from "../auth/utils";

const promptNameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(100, "name must be 100 characters or fewer")
  .transform((value) => normalizeName(value) ?? value);

export const createPromptSchema = z.object({
  name: promptNameSchema,
  description: z.string().trim().max(500).nullish(),
  content: z.string().min(1, "content is required"),
  model: z.string().trim().min(1).max(200).nullish(),
  temperature: z.number().min(0).max(2).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const createVersionSchema = z.object({
  content: z.string().min(1, "content is required"),
  model: z.string().trim().min(1).max(200).nullish(),
  temperature: z.number().min(0).max(2).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const setActiveVersionSchema = z.object({
  versionId: z.string().min(1, "versionId is required"),
});
