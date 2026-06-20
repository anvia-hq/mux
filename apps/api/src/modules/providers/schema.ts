import { z } from "zod";

/**
 * Supported provider identifiers. The router uses this as a whitelist so a
 * random string in the URL can't be turned into a fake DB row.
 */
export const providerNames = ["openai", "anthropic", "google", "mistral"] as const;

export const providerNameSchema = z.enum(providerNames);

export const setProviderKeySchema = z.object({
  apiKey: z.string().min(8),
});
