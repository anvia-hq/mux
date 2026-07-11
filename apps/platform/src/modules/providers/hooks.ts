import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";
import type { Model, ModelPricingTier } from "../models/hooks";

export type ProviderRow = {
  provider: string;
  lastFour: string | null;
  updatedAt: string;
  updater?: { email: string };
};

export type ProviderCatalogRow = {
  provider: string;
  name: string;
  type: "built-in" | "custom" | "unknown";
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
  updater?: { email: string } | null;
  apiBase: string | null;
  modelCount: number | null;
};

export const PROVIDER_NAMES = [
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
export type ProviderName = string;

export const PROVIDER_LABELS = {
  requesty: "Requesty",
  "qiniu-ai": "Qiniu",
  "alibaba-cn": "Alibaba (China)",
  "regolo-ai": "Regolo AI",
  stackit: "STACKIT",
  vercel: "Vercel AI Gateway",
  submodel: "submodel",
  sumopod: "Sumopod",
  huggingface: "Hugging Face",
  "minimax-coding-plan": "MiniMax Token Plan (minimax.io)",
  "novita-ai": "NovitaAI",
  xai: "xAI",
  "privatemode-ai": "Privatemode AI",
  drun: "D.Run (China)",
  "alibaba-token-plan-cn": "Alibaba Token Plan (China)",
  moonshotai: "Moonshot AI",
  "fireworks-ai": "Fireworks AI",
  vultr: "Vultr",
  "302ai": "302.AI",
  zhipuai: "Zhipu AI",
  cortecs: "Cortecs",
  nebius: "Nebius Token Factory",
  auriko: "Auriko",
  "stepfun-ai": "StepFun AI",
  vivgrid: "Vivgrid",
  mistral: "Mistral",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  bailing: "Bailing",
  anyapi: "AnyAPI",
  google: "Google",
  "opencode-go": "OpenCode Go",
  digitalocean: "DigitalOcean",
  venice: "Venice AI",
  lmstudio: "LMStudio",
  poolside: "Poolside",
  zenmux: "ZenMux",
  openai: "OpenAI",
  berget: "Berget.AI",
  "snowflake-cortex": "Snowflake Cortex",
  "github-models": "GitHub Models",
  neuralwatt: "Neuralwatt",
  "siliconflow-cn": "SiliconFlow (China)",
  "merge-gateway": "Merge Gateway",
  "qihang-ai": "QiHang",
  "xiaomi-token-plan-ams": "Xiaomi Token Plan (Europe)",
  modelscope: "ModelScope",
  groq: "Groq",
  mixlayer: "Mixlayer",
  orcarouter: "OrcaRouter",
  helicone: "Helicone",
  zai: "Z.AI",
  nearai: "NEAR AI Cloud",
  llmgateway: "LLM Gateway",
  "alibaba-coding-plan-cn": "Alibaba Coding Plan (China)",
  abacus: "Abacus",
  "cloudferro-sherlock": "CloudFerro Sherlock",
  "ollama-cloud": "Ollama Cloud",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "moonshotai-cn": "Moonshot AI (China)",
  morph: "Morph",
  deepinfra: "Deep Infra",
  "google-vertex-anthropic": "Vertex (Anthropic)",
  v0: "v0",
  azure: "Azure",
  cerebras: "Cerebras",
  "zai-coding-plan": "Z.AI Coding Plan",
  nvidia: "Nvidia",
  evroc: "evroc",
  xiaomi: "Xiaomi",
  inception: "Inception",
  anthropic: "Anthropic",
  "tencent-coding-plan": "Tencent Coding Plan (China)",
  freemodel: "FreeModel",
  "sap-ai-core": "SAP AI Core",
  opencode: "OpenCode Zen",
  inference: "Inference",
  inceptron: "Inceptron",
  llama: "Llama",
  llmtr: "LLMTR",
  cohere: "Cohere",
  sarvam: "Sarvam AI",
  stepfun: "StepFun",
  "hpc-ai": "HPC-AI",
  "minimax-cn": "MiniMax (minimaxi.com)",
  "alibaba-coding-plan": "Alibaba Coding Plan",
  poe: "Poe",
  "kimi-for-coding": "Kimi For Coding",
  dinference: "DInference",
  "perplexity-agent": "Perplexity Agent",
  siliconflow: "SiliconFlow",
  "umans-ai-coding-plan": "Umans AI Coding Plan",
  "io-net": "IO.NET",
  gmicloud: "GMI Cloud",
  "xiaomi-token-plan-cn": "Xiaomi Token Plan (China)",
  zeldoc: "Zeldoc",
  scaleway: "Scaleway",
  ovhcloud: "OVHcloud AI Endpoints",
  friendli: "Friendli",
  "tencent-tokenhub": "Tencent TokenHub",
  wandb: "Weights & Biases",
  "kuae-cloud-coding-plan": "KUAE Cloud Coding Plan",
  gitlab: "GitLab Duo",
  kilo: "Kilo Gateway",
  lucidquery: "LucidQuery",
  meganova: "Meganova",
  perplexity: "Perplexity",
  "amazon-bedrock": "Amazon Bedrock",
  "umans-ai": "Umans AI",
  togetherai: "Together AI",
  frogbot: "FrogBot",
  openrouter: "OpenRouter",
  jiekou: "Jiekou.AI",
  nova: "Nova",
  "alibaba-token-plan": "Alibaba Token Plan",
  alibaba: "Alibaba",
  databricks: "Databricks",
  crof: "CrofAI",
  fastrouter: "FastRouter",
  "abliteration-ai": "abliteration.ai",
  xpersona: "Xpersona",
  "azure-cognitive-services": "Azure Cognitive Services",
  baseten: "Baseten",
  "atomic-chat": "Atomic Chat",
  "routing-run": "routing.run",
  aihubmix: "AIHubMix",
  "google-vertex": "Vertex",
  "nano-gpt": "NanoGPT",
  moark: "Moark",
  lilac: "Lilac",
  ambient: "Ambient",
  neon: "Neon",
  upstage: "Upstage",
  "zhipuai-coding-plan": "Zhipu AI Coding Plan",
  chutes: "Chutes",
  "minimax-cn-coding-plan": "MiniMax Token Plan (minimaxi.com)",
  deepseek: "DeepSeek",
  "wafer.ai": "Wafer",
  minimax: "MiniMax (minimax.io)",
  "github-copilot": "GitHub Copilot",
  clarifai: "Clarifai",
  "the-grid-ai": "The Grid AI",
  synthetic: "Synthetic",
  iflowcn: "iFlow",
  "xiaomi-token-plan-sgp": "Xiaomi Token Plan (Singapore)",
  claudinio: "Claudinio",
} satisfies Record<(typeof PROVIDER_NAMES)[number], string>;

export function providerLabel(provider: string, customName?: string | null) {
  return customName || PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] || provider;
}

const providersKey = ["providers"] as const;
const providerCatalogKey = ["providers", "catalog"] as const;

export function useProvidersQuery() {
  return useQuery({
    queryKey: providersKey,
    queryFn: () => apiFetch<{ providers: ProviderRow[] }>("/providers"),
  });
}

export function useProviderCatalogQuery() {
  return useQuery({
    queryKey: providerCatalogKey,
    queryFn: () => apiFetch<{ providers: ProviderCatalogRow[] }>("/providers/catalog"),
  });
}

export function useSetProviderKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: string; apiKey: string }) =>
      apiFetch<{ provider: ProviderRow }>(`/providers/${input.provider}`, {
        method: "PUT",
        body: { apiKey: input.apiKey },
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: providersKey });
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["providers", input.provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export function useDeleteProviderKeyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      apiFetch<{ ok: true }>(`/providers/${provider}`, { method: "DELETE" }),
    onSuccess: (_data, provider) => {
      qc.invalidateQueries({ queryKey: providersKey });
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export type ProviderModel = Model & { enabled: boolean };

export type CustomProviderModelInput = {
  id: string;
  name: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  pricingTiers?: ModelPricingTier[];
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  weights: "open" | "closed";
};

export type CreateCustomProviderInput = {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
  models: CustomProviderModelInput[];
};

export type UpdateCustomProviderInput = {
  id: string;
  name?: string;
  apiBase?: string;
  apiKey?: string;
};

export function useCreateCustomProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomProviderInput) =>
      apiFetch<{ provider: ProviderCatalogRow }>("/providers/custom", {
        method: "POST",
        body: input,
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: providersKey });
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["providers", input.id, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export function useUpdateCustomProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCustomProviderInput) =>
      apiFetch<{ provider: ProviderCatalogRow }>(`/providers/custom/${id}`, {
        method: "PUT",
        body,
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["providers", input.id, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export function useDeleteCustomProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) =>
      apiFetch<{ ok: true }>(`/providers/custom/${provider}`, { method: "DELETE" }),
    onSuccess: (_data, provider) => {
      qc.invalidateQueries({ queryKey: providersKey });
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
      qc.invalidateQueries({ queryKey: ["fallback-groups"] });
    },
  });
}

export function useProviderModelsQuery(provider: string) {
  return useQuery({
    queryKey: ["providers", provider, "models"],
    queryFn: () => apiFetch<{ data: ProviderModel[] }>(`/providers/${provider}/models`),
  });
}

export function useToggleModelMutation(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { modelId: string; enabled: boolean }) =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/toggle`, {
        method: "PUT",
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export function useReplaceCustomProviderModelsMutation(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (models: CustomProviderModelInput[]) =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models`, {
        method: "PUT",
        body: { models },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: providerCatalogKey });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
      qc.invalidateQueries({ queryKey: ["fallback-groups"] });
    },
  });
}

export function useEnableAllMutation(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/enable-all`, {
        method: "PUT",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}

export function useDisableAllMutation(provider: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/providers/${provider}/models/disable-all`, {
        method: "PUT",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", provider, "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "models"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "model-targets"] });
    },
  });
}
