import { z } from "zod";

/**
 * Supported provider identifiers. The router uses this as a whitelist so a
 * random string in the URL can't be turned into a fake DB row.
 */
export const providerNames = [
  "requesty",
  "qiniu-ai",
  "alibaba-cn",
  "regolo-ai",
  "stackit",
  "vercel",
  "submodel",
  "sumopod",
  "huggingface",
  "minimax-coding-plan",
  "novita-ai",
  "xai",
  "privatemode-ai",
  "drun",
  "alibaba-token-plan-cn",
  "moonshotai",
  "fireworks-ai",
  "vultr",
  "302ai",
  "zhipuai",
  "cortecs",
  "nebius",
  "auriko",
  "stepfun-ai",
  "vivgrid",
  "mistral",
  "cloudflare-workers-ai",
  "bailing",
  "anyapi",
  "google",
  "opencode-go",
  "digitalocean",
  "venice",
  "lmstudio",
  "poolside",
  "zenmux",
  "openai",
  "berget",
  "snowflake-cortex",
  "github-models",
  "neuralwatt",
  "siliconflow-cn",
  "merge-gateway",
  "qihang-ai",
  "xiaomi-token-plan-ams",
  "modelscope",
  "groq",
  "mixlayer",
  "orcarouter",
  "helicone",
  "zai",
  "nearai",
  "llmgateway",
  "alibaba-coding-plan-cn",
  "abacus",
  "cloudferro-sherlock",
  "ollama-cloud",
  "cloudflare-ai-gateway",
  "moonshotai-cn",
  "morph",
  "deepinfra",
  "google-vertex-anthropic",
  "v0",
  "azure",
  "cerebras",
  "zai-coding-plan",
  "nvidia",
  "evroc",
  "xiaomi",
  "inception",
  "anthropic",
  "tencent-coding-plan",
  "freemodel",
  "sap-ai-core",
  "opencode",
  "inference",
  "inceptron",
  "llama",
  "llmtr",
  "cohere",
  "sarvam",
  "stepfun",
  "hpc-ai",
  "minimax-cn",
  "alibaba-coding-plan",
  "poe",
  "kimi-for-coding",
  "dinference",
  "perplexity-agent",
  "siliconflow",
  "umans-ai-coding-plan",
  "io-net",
  "gmicloud",
  "xiaomi-token-plan-cn",
  "zeldoc",
  "scaleway",
  "ovhcloud",
  "friendli",
  "tencent-tokenhub",
  "wandb",
  "kuae-cloud-coding-plan",
  "gitlab",
  "kilo",
  "lucidquery",
  "meganova",
  "perplexity",
  "amazon-bedrock",
  "umans-ai",
  "togetherai",
  "frogbot",
  "openrouter",
  "jiekou",
  "nova",
  "alibaba-token-plan",
  "alibaba",
  "databricks",
  "crof",
  "fastrouter",
  "abliteration-ai",
  "xpersona",
  "azure-cognitive-services",
  "baseten",
  "atomic-chat",
  "routing-run",
  "aihubmix",
  "google-vertex",
  "nano-gpt",
  "moark",
  "lilac",
  "ambient",
  "neon",
  "upstage",
  "zhipuai-coding-plan",
  "chutes",
  "minimax-cn-coding-plan",
  "deepseek",
  "wafer.ai",
  "minimax",
  "github-copilot",
  "clarifai",
  "the-grid-ai",
  "synthetic",
  "iflowcn",
  "xiaomi-token-plan-sgp",
  "claudinio",
] as const;

export type BuiltInProviderName = (typeof providerNames)[number];

export function isBuiltInProviderName(value: string): value is BuiltInProviderName {
  return providerNames.includes(value as BuiltInProviderName);
}

export function isReservedProviderName(value: string): boolean {
  return value === "mux" || isBuiltInProviderName(value);
}

export const providerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, {
    message:
      "provider id must use lowercase letters, numbers, dots, underscores, or hyphens, and cannot start or end with punctuation",
  });

export const setProviderKeySchema = z.object({
  apiKey: z.string().min(8),
});

const modelIdSchema = z.string().trim().min(1).max(256);

export const customProviderModelSchema = z.object({
  id: modelIdSchema,
  name: z.string().trim().min(1).max(160),
  inputPricePer1M: z.number().finite().nonnegative(),
  outputPricePer1M: z.number().finite().nonnegative(),
  contextWindow: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  inputModalities: z.array(z.string().trim().min(1).max(32)).min(1).max(8),
  outputModalities: z.array(z.string().trim().min(1).max(32)).min(1).max(8),
  reasoning: z.boolean().default(true),
  toolCall: z.boolean().default(true),
  structuredOutput: z.boolean().default(true),
  weights: z.enum(["open", "closed"]),
});

const customProviderModelsSchema = z
  .array(customProviderModelSchema)
  .min(1)
  .max(200)
  .superRefine((models, ctx) => {
    const seen = new Set<string>();
    for (const [index, model] of models.entries()) {
      if (seen.has(model.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate model id: ${model.id}`,
          path: [index, "id"],
        });
      }
      seen.add(model.id);
    }
  });

export const createCustomProviderSchema = z.object({
  id: providerNameSchema.refine((id) => !isReservedProviderName(id), {
    message: "provider id is reserved",
  }),
  name: z.string().trim().min(1).max(120),
  apiBase: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
      message: "apiBase must be an http(s) URL",
    }),
  apiKey: z.string().min(8),
  models: customProviderModelsSchema,
});

export const updateCustomProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    apiBase: z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
        message: "apiBase must be an http(s) URL",
      })
      .optional(),
    apiKey: z.string().min(8).optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.apiBase !== undefined || input.apiKey !== undefined,
    {
      message: "at least one field must be provided",
    },
  );

export const replaceCustomProviderModelsSchema = z.object({
  models: customProviderModelsSchema,
});

export type CustomProviderModelInput = z.infer<typeof customProviderModelSchema>;
