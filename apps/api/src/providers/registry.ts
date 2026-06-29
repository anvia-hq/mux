import type { ProviderAdapter, Model } from "./types";
import { RequestyAdapter } from "./requesty";
import { QiniuAiAdapter } from "./qiniu-ai";
import { AlibabaCnAdapter } from "./alibaba-cn";
import { RegoloAiAdapter } from "./regolo-ai";
import { StackitAdapter } from "./stackit";
import { VercelAdapter } from "./vercel";
import { SubmodelAdapter } from "./submodel";
import { HuggingfaceAdapter } from "./huggingface";
import { MinimaxCodingPlanAdapter } from "./minimax-coding-plan";
import { NovitaAiAdapter } from "./novita-ai";
import { XaiAdapter } from "./xai";
import { PrivatemodeAiAdapter } from "./privatemode-ai";
import { DrunAdapter } from "./drun";
import { AlibabaTokenPlanCnAdapter } from "./alibaba-token-plan-cn";
import { MoonshotaiAdapter } from "./moonshotai";
import { FireworksAiAdapter } from "./fireworks-ai";
import { VultrAdapter } from "./vultr";
import { Provider302aiAdapter } from "./302ai";
import { ZhipuaiAdapter } from "./zhipuai";
import { CortecsAdapter } from "./cortecs";
import { NebiusAdapter } from "./nebius";
import { AurikoAdapter } from "./auriko";
import { StepfunAiAdapter } from "./stepfun-ai";
import { VivgridAdapter } from "./vivgrid";
import { MistralAdapter } from "./mistral";
import { CloudflareWorkersAiAdapter } from "./cloudflare-workers-ai";
import { BailingAdapter } from "./bailing";
import { AnyapiAdapter } from "./anyapi";
import { GoogleAdapter } from "./google";
import { OpencodeGoAdapter } from "./opencode-go";
import { DigitaloceanAdapter } from "./digitalocean";
import { VeniceAdapter } from "./venice";
import { LmstudioAdapter } from "./lmstudio";
import { PoolsideAdapter } from "./poolside";
import { ZenmuxAdapter } from "./zenmux";
import { OpenAIAdapter } from "./openai";
import { BergetAdapter } from "./berget";
import { SnowflakeCortexAdapter } from "./snowflake-cortex";
import { GithubModelsAdapter } from "./github-models";
import { NeuralwattAdapter } from "./neuralwatt";
import { SiliconflowCnAdapter } from "./siliconflow-cn";
import { MergeGatewayAdapter } from "./merge-gateway";
import { QihangAiAdapter } from "./qihang-ai";
import { XiaomiTokenPlanAmsAdapter } from "./xiaomi-token-plan-ams";
import { ModelscopeAdapter } from "./modelscope";
import { GroqAdapter } from "./groq";
import { MixlayerAdapter } from "./mixlayer";
import { OrcarouterAdapter } from "./orcarouter";
import { HeliconeAdapter } from "./helicone";
import { ZaiAdapter } from "./zai";
import { NearaiAdapter } from "./nearai";
import { LlmgatewayAdapter } from "./llmgateway";
import { AlibabaCodingPlanCnAdapter } from "./alibaba-coding-plan-cn";
import { AbacusAdapter } from "./abacus";
import { CloudferroSherlockAdapter } from "./cloudferro-sherlock";
import { OllamaCloudAdapter } from "./ollama-cloud";
import { CloudflareAiGatewayAdapter } from "./cloudflare-ai-gateway";
import { MoonshotaiCnAdapter } from "./moonshotai-cn";
import { MorphAdapter } from "./morph";
import { DeepinfraAdapter } from "./deepinfra";
import { GoogleVertexAnthropicAdapter } from "./google-vertex-anthropic";
import { V0Adapter } from "./v0";
import { AzureAdapter } from "./azure";
import { CerebrasAdapter } from "./cerebras";
import { ZaiCodingPlanAdapter } from "./zai-coding-plan";
import { NvidiaAdapter } from "./nvidia";
import { EvrocAdapter } from "./evroc";
import { XiaomiAdapter } from "./xiaomi";
import { InceptionAdapter } from "./inception";
import { AnthropicAdapter } from "./anthropic";
import { TencentCodingPlanAdapter } from "./tencent-coding-plan";
import { FreemodelAdapter } from "./freemodel";
import { SapAiCoreAdapter } from "./sap-ai-core";
import { OpencodeAdapter } from "./opencode";
import { InferenceAdapter } from "./inference";
import { InceptronAdapter } from "./inceptron";
import { LlamaAdapter } from "./llama";
import { LlmtrAdapter } from "./llmtr";
import { CohereAdapter } from "./cohere";
import { SarvamAdapter } from "./sarvam";
import { StepfunAdapter } from "./stepfun";
import { HpcAiAdapter } from "./hpc-ai";
import { MinimaxCnAdapter } from "./minimax-cn";
import { AlibabaCodingPlanAdapter } from "./alibaba-coding-plan";
import { PoeAdapter } from "./poe";
import { KimiForCodingAdapter } from "./kimi-for-coding";
import { DinferenceAdapter } from "./dinference";
import { PerplexityAgentAdapter } from "./perplexity-agent";
import { SiliconflowAdapter } from "./siliconflow";
import { UmansAiCodingPlanAdapter } from "./umans-ai-coding-plan";
import { IoNetAdapter } from "./io-net";
import { GmicloudAdapter } from "./gmicloud";
import { XiaomiTokenPlanCnAdapter } from "./xiaomi-token-plan-cn";
import { ZeldocAdapter } from "./zeldoc";
import { ScalewayAdapter } from "./scaleway";
import { OvhcloudAdapter } from "./ovhcloud";
import { FriendliAdapter } from "./friendli";
import { TencentTokenhubAdapter } from "./tencent-tokenhub";
import { WandbAdapter } from "./wandb";
import { KuaeCloudCodingPlanAdapter } from "./kuae-cloud-coding-plan";
import { GitlabAdapter } from "./gitlab";
import { KiloAdapter } from "./kilo";
import { LucidqueryAdapter } from "./lucidquery";
import { MeganovaAdapter } from "./meganova";
import { PerplexityAdapter } from "./perplexity";
import { AmazonBedrockAdapter } from "./amazon-bedrock";
import { UmansAiAdapter } from "./umans-ai";
import { TogetheraiAdapter } from "./togetherai";
import { FrogbotAdapter } from "./frogbot";
import { OpenrouterAdapter } from "./openrouter";
import { JiekouAdapter } from "./jiekou";
import { NovaAdapter } from "./nova";
import { AlibabaTokenPlanAdapter } from "./alibaba-token-plan";
import { AlibabaAdapter } from "./alibaba";
import { DatabricksAdapter } from "./databricks";
import { CrofAdapter } from "./crof";
import { FastrouterAdapter } from "./fastrouter";
import { AbliterationAiAdapter } from "./abliteration-ai";
import { XpersonaAdapter } from "./xpersona";
import { AzureCognitiveServicesAdapter } from "./azure-cognitive-services";
import { BasetenAdapter } from "./baseten";
import { AtomicChatAdapter } from "./atomic-chat";
import { RoutingRunAdapter } from "./routing-run";
import { AihubmixAdapter } from "./aihubmix";
import { GoogleVertexAdapter } from "./google-vertex";
import { NanoGptAdapter } from "./nano-gpt";
import { MoarkAdapter } from "./moark";
import { LilacAdapter } from "./lilac";
import { AmbientAdapter } from "./ambient";
import { NeonAdapter } from "./neon";
import { UpstageAdapter } from "./upstage";
import { ZhipuaiCodingPlanAdapter } from "./zhipuai-coding-plan";
import { ChutesAdapter } from "./chutes";
import { MinimaxCnCodingPlanAdapter } from "./minimax-cn-coding-plan";
import { DeepseekAdapter } from "./deepseek";
import { WaferAiAdapter } from "./wafer.ai";
import { MinimaxAdapter } from "./minimax";
import { GithubCopilotAdapter } from "./github-copilot";
import { ClarifaiAdapter } from "./clarifai";
import { TheGridAiAdapter } from "./the-grid-ai";
import { SyntheticAdapter } from "./synthetic";
import { E2eAdapter } from "./e2e";
import { IflowcnAdapter } from "./iflowcn";
import { XiaomiTokenPlanSgpAdapter } from "./xiaomi-token-plan-sgp";
import { ClaudinioAdapter } from "./claudinio";
import { prisma } from "../utils/prisma";
import { decrypt } from "../modules/providers/crypto";
import { applyRuntimeCapabilities } from "./chat-compat";

const providers: Map<string, ProviderAdapter> = new Map();
export const FALLBACK_GROUP_PROVIDER = "mux";

const adapterFactories: Record<string, (apiKey: string) => ProviderAdapter | null> = {
  requesty: (apiKey) => new RequestyAdapter(apiKey),
  "qiniu-ai": (apiKey) => new QiniuAiAdapter(apiKey),
  "alibaba-cn": (apiKey) => new AlibabaCnAdapter(apiKey),
  "regolo-ai": (apiKey) => new RegoloAiAdapter(apiKey),
  stackit: (apiKey) => new StackitAdapter(apiKey),
  vercel: (apiKey) => new VercelAdapter(apiKey),
  submodel: (apiKey) => new SubmodelAdapter(apiKey),
  huggingface: (apiKey) => new HuggingfaceAdapter(apiKey),
  "minimax-coding-plan": (apiKey) => new MinimaxCodingPlanAdapter(apiKey),
  "novita-ai": (apiKey) => new NovitaAiAdapter(apiKey),
  xai: (apiKey) => new XaiAdapter(apiKey),
  "privatemode-ai": (apiKey) => new PrivatemodeAiAdapter(apiKey),
  drun: (apiKey) => new DrunAdapter(apiKey),
  "alibaba-token-plan-cn": (apiKey) => new AlibabaTokenPlanCnAdapter(apiKey),
  moonshotai: (apiKey) => new MoonshotaiAdapter(apiKey),
  "fireworks-ai": (apiKey) => new FireworksAiAdapter(apiKey),
  vultr: (apiKey) => new VultrAdapter(apiKey),
  "302ai": (apiKey) => new Provider302aiAdapter(apiKey),
  zhipuai: (apiKey) => new ZhipuaiAdapter(apiKey),
  cortecs: (apiKey) => new CortecsAdapter(apiKey),
  nebius: (apiKey) => new NebiusAdapter(apiKey),
  auriko: (apiKey) => new AurikoAdapter(apiKey),
  "stepfun-ai": (apiKey) => new StepfunAiAdapter(apiKey),
  vivgrid: (apiKey) => new VivgridAdapter(apiKey),
  mistral: (apiKey) => new MistralAdapter(apiKey),
  "cloudflare-workers-ai": (apiKey) => new CloudflareWorkersAiAdapter(apiKey),
  bailing: (apiKey) => new BailingAdapter(apiKey),
  anyapi: (apiKey) => new AnyapiAdapter(apiKey),
  google: (apiKey) => new GoogleAdapter(apiKey),
  "opencode-go": (apiKey) => new OpencodeGoAdapter(apiKey),
  digitalocean: (apiKey) => new DigitaloceanAdapter(apiKey),
  venice: (apiKey) => new VeniceAdapter(apiKey),
  lmstudio: (apiKey) => new LmstudioAdapter(apiKey),
  poolside: (apiKey) => new PoolsideAdapter(apiKey),
  zenmux: (apiKey) => new ZenmuxAdapter(apiKey),
  openai: (apiKey) => new OpenAIAdapter(apiKey),
  berget: (apiKey) => new BergetAdapter(apiKey),
  "snowflake-cortex": (apiKey) => new SnowflakeCortexAdapter(apiKey),
  "github-models": (apiKey) => new GithubModelsAdapter(apiKey),
  neuralwatt: (apiKey) => new NeuralwattAdapter(apiKey),
  "siliconflow-cn": (apiKey) => new SiliconflowCnAdapter(apiKey),
  "merge-gateway": (apiKey) => new MergeGatewayAdapter(apiKey),
  "qihang-ai": (apiKey) => new QihangAiAdapter(apiKey),
  "xiaomi-token-plan-ams": (apiKey) => new XiaomiTokenPlanAmsAdapter(apiKey),
  modelscope: (apiKey) => new ModelscopeAdapter(apiKey),
  groq: (apiKey) => new GroqAdapter(apiKey),
  mixlayer: (apiKey) => new MixlayerAdapter(apiKey),
  orcarouter: (apiKey) => new OrcarouterAdapter(apiKey),
  helicone: (apiKey) => new HeliconeAdapter(apiKey),
  zai: (apiKey) => new ZaiAdapter(apiKey),
  nearai: (apiKey) => new NearaiAdapter(apiKey),
  llmgateway: (apiKey) => new LlmgatewayAdapter(apiKey),
  "alibaba-coding-plan-cn": (apiKey) => new AlibabaCodingPlanCnAdapter(apiKey),
  abacus: (apiKey) => new AbacusAdapter(apiKey),
  "cloudferro-sherlock": (apiKey) => new CloudferroSherlockAdapter(apiKey),
  "ollama-cloud": (apiKey) => new OllamaCloudAdapter(apiKey),
  "cloudflare-ai-gateway": (apiKey) => new CloudflareAiGatewayAdapter(apiKey),
  "moonshotai-cn": (apiKey) => new MoonshotaiCnAdapter(apiKey),
  morph: (apiKey) => new MorphAdapter(apiKey),
  deepinfra: (apiKey) => new DeepinfraAdapter(apiKey),
  "google-vertex-anthropic": (apiKey) => new GoogleVertexAnthropicAdapter(apiKey),
  v0: (apiKey) => new V0Adapter(apiKey),
  azure: (apiKey) => new AzureAdapter(apiKey),
  cerebras: (apiKey) => new CerebrasAdapter(apiKey),
  "zai-coding-plan": (apiKey) => new ZaiCodingPlanAdapter(apiKey),
  nvidia: (apiKey) => new NvidiaAdapter(apiKey),
  evroc: (apiKey) => new EvrocAdapter(apiKey),
  xiaomi: (apiKey) => new XiaomiAdapter(apiKey),
  inception: (apiKey) => new InceptionAdapter(apiKey),
  anthropic: (apiKey) => new AnthropicAdapter(apiKey),
  "tencent-coding-plan": (apiKey) => new TencentCodingPlanAdapter(apiKey),
  freemodel: (apiKey) => new FreemodelAdapter(apiKey),
  "sap-ai-core": (apiKey) => new SapAiCoreAdapter(apiKey),
  opencode: (apiKey) => new OpencodeAdapter(apiKey),
  inference: (apiKey) => new InferenceAdapter(apiKey),
  inceptron: (apiKey) => new InceptronAdapter(apiKey),
  llama: (apiKey) => new LlamaAdapter(apiKey),
  llmtr: (apiKey) => new LlmtrAdapter(apiKey),
  cohere: (apiKey) => new CohereAdapter(apiKey),
  sarvam: (apiKey) => new SarvamAdapter(apiKey),
  stepfun: (apiKey) => new StepfunAdapter(apiKey),
  "hpc-ai": (apiKey) => new HpcAiAdapter(apiKey),
  "minimax-cn": (apiKey) => new MinimaxCnAdapter(apiKey),
  "alibaba-coding-plan": (apiKey) => new AlibabaCodingPlanAdapter(apiKey),
  poe: (apiKey) => new PoeAdapter(apiKey),
  "kimi-for-coding": (apiKey) => new KimiForCodingAdapter(apiKey),
  dinference: (apiKey) => new DinferenceAdapter(apiKey),
  "perplexity-agent": (apiKey) => new PerplexityAgentAdapter(apiKey),
  siliconflow: (apiKey) => new SiliconflowAdapter(apiKey),
  "umans-ai-coding-plan": (apiKey) => new UmansAiCodingPlanAdapter(apiKey),
  "io-net": (apiKey) => new IoNetAdapter(apiKey),
  gmicloud: (apiKey) => new GmicloudAdapter(apiKey),
  "xiaomi-token-plan-cn": (apiKey) => new XiaomiTokenPlanCnAdapter(apiKey),
  zeldoc: (apiKey) => new ZeldocAdapter(apiKey),
  scaleway: (apiKey) => new ScalewayAdapter(apiKey),
  ovhcloud: (apiKey) => new OvhcloudAdapter(apiKey),
  friendli: (apiKey) => new FriendliAdapter(apiKey),
  "tencent-tokenhub": (apiKey) => new TencentTokenhubAdapter(apiKey),
  wandb: (apiKey) => new WandbAdapter(apiKey),
  "kuae-cloud-coding-plan": (apiKey) => new KuaeCloudCodingPlanAdapter(apiKey),
  gitlab: (apiKey) => new GitlabAdapter(apiKey),
  kilo: (apiKey) => new KiloAdapter(apiKey),
  lucidquery: (apiKey) => new LucidqueryAdapter(apiKey),
  meganova: (apiKey) => new MeganovaAdapter(apiKey),
  perplexity: (apiKey) => new PerplexityAdapter(apiKey),
  "amazon-bedrock": (apiKey) => new AmazonBedrockAdapter(apiKey),
  "umans-ai": (apiKey) => new UmansAiAdapter(apiKey),
  togetherai: (apiKey) => new TogetheraiAdapter(apiKey),
  frogbot: (apiKey) => new FrogbotAdapter(apiKey),
  openrouter: (apiKey) => new OpenrouterAdapter(apiKey),
  jiekou: (apiKey) => new JiekouAdapter(apiKey),
  nova: (apiKey) => new NovaAdapter(apiKey),
  "alibaba-token-plan": (apiKey) => new AlibabaTokenPlanAdapter(apiKey),
  alibaba: (apiKey) => new AlibabaAdapter(apiKey),
  databricks: (apiKey) => new DatabricksAdapter(apiKey),
  crof: (apiKey) => new CrofAdapter(apiKey),
  fastrouter: (apiKey) => new FastrouterAdapter(apiKey),
  "abliteration-ai": (apiKey) => new AbliterationAiAdapter(apiKey),
  xpersona: (apiKey) => new XpersonaAdapter(apiKey),
  "azure-cognitive-services": (apiKey) => new AzureCognitiveServicesAdapter(apiKey),
  baseten: (apiKey) => new BasetenAdapter(apiKey),
  "atomic-chat": (apiKey) => new AtomicChatAdapter(apiKey),
  "routing-run": (apiKey) => new RoutingRunAdapter(apiKey),
  aihubmix: (apiKey) => new AihubmixAdapter(apiKey),
  "google-vertex": (apiKey) => new GoogleVertexAdapter(apiKey),
  "nano-gpt": (apiKey) => new NanoGptAdapter(apiKey),
  moark: (apiKey) => new MoarkAdapter(apiKey),
  lilac: (apiKey) => new LilacAdapter(apiKey),
  ambient: (apiKey) => new AmbientAdapter(apiKey),
  neon: (apiKey) => new NeonAdapter(apiKey),
  upstage: (apiKey) => new UpstageAdapter(apiKey),
  "zhipuai-coding-plan": (apiKey) => new ZhipuaiCodingPlanAdapter(apiKey),
  chutes: (apiKey) => new ChutesAdapter(apiKey),
  "minimax-cn-coding-plan": (apiKey) => new MinimaxCnCodingPlanAdapter(apiKey),
  deepseek: (apiKey) => new DeepseekAdapter(apiKey),
  "wafer.ai": (apiKey) => new WaferAiAdapter(apiKey),
  minimax: (apiKey) => new MinimaxAdapter(apiKey),
  "github-copilot": (apiKey) => new GithubCopilotAdapter(apiKey),
  clarifai: (apiKey) => new ClarifaiAdapter(apiKey),
  "the-grid-ai": (apiKey) => new TheGridAiAdapter(apiKey),
  synthetic: (apiKey) => new SyntheticAdapter(apiKey),
  e2e: (apiKey) => (process.env.E2E_RESET_TOKEN ? new E2eAdapter(apiKey) : null),
  iflowcn: (apiKey) => new IflowcnAdapter(apiKey),
  "xiaomi-token-plan-sgp": (apiKey) => new XiaomiTokenPlanSgpAdapter(apiKey),
  claudinio: (apiKey) => new ClaudinioAdapter(apiKey),
};

function buildAdapter(provider: string, apiKey: string): ProviderAdapter | null {
  return adapterFactories[provider]?.(apiKey) ?? null;
}

/**
 * Reads provider keys from the database and seeds the in-memory adapter cache.
 * Provider keys are NEVER read from environment variables — they are stored
 * encrypted at rest and managed exclusively via the dashboard / providers API.
 */
export async function initProviders() {
  try {
    const rows = await prisma.providerKey.findMany();
    for (const row of rows) {
      const apiKey = decrypt(row.ciphertext);
      const adapter = buildAdapter(row.provider, apiKey);
      if (adapter) providers.set(row.provider, adapter);
    }
  } catch (error) {
    console.warn(
      "ProviderKey table not available yet:",
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`Initialized providers: ${Array.from(providers.keys()).join(", ") || "(none)"}`);
}

/**
 * Loads a single provider from the database, replacing any cached instance.
 * Called after PUT/DELETE on the providers API so changes apply immediately.
 */
export async function reloadProvider(name: string): Promise<void> {
  const row = await prisma.providerKey.findUnique({ where: { provider: name } });
  if (!row) {
    providers.delete(name);
    return;
  }
  const apiKey = decrypt(row.ciphertext);
  const adapter = buildAdapter(name, apiKey);
  if (adapter) {
    providers.set(name, adapter);
  } else {
    providers.delete(name);
  }
}

export function clearProviderCacheForE2e(): void {
  providers.clear();
}

export type ResolvedProviderModel = {
  provider: ProviderAdapter;
  providerName: string;
  modelId: string;
  publicModelId: string;
};

export type ResolvedFallbackGroup = {
  groupId: string;
  name: string;
  description: string | null;
  publicModelId: string;
  targets: ResolvedProviderModel[];
};

export type ResolvedChatModel =
  | {
      kind: "direct";
      requestedModelId: string;
      targets: [ResolvedProviderModel];
    }
  | {
      kind: "fallback-group";
      groupId: string;
      name: string;
      description: string | null;
      requestedModelId: string;
      targets: ResolvedProviderModel[];
    };

export function toPublicModelId(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

export function toFallbackGroupModelId(groupId: string): string {
  return toPublicModelId(FALLBACK_GROUP_PROVIDER, groupId);
}

function disabledModelKey(provider: string, modelId: string): string {
  return toPublicModelId(provider, modelId);
}

async function listDisabledModelKeys(): Promise<Set<string>> {
  const rows = await prisma.disabledModel.findMany({ select: { modelId: true, provider: true } });
  return new Set(rows.map((row) => disabledModelKey(row.provider, row.modelId)));
}

function isModelDisabled(disabledModels: Set<string>, provider: string, modelId: string): boolean {
  return disabledModels.has(disabledModelKey(provider, modelId));
}

function parsePublicModelId(model: string): { providerName: string; modelId: string } | null {
  const separatorIndex = model.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    return null;
  }

  return {
    providerName: model.slice(0, separatorIndex),
    modelId: model.slice(separatorIndex + 1),
  };
}

function parseFallbackGroupModelId(model: string): string | null {
  const parsed = parsePublicModelId(model);
  if (!parsed || parsed.providerName !== FALLBACK_GROUP_PROVIDER) {
    return null;
  }
  return parsed.modelId;
}

export function resolveProviderModel(model: string): ResolvedProviderModel | null {
  const parsed = parsePublicModelId(model);
  if (!parsed) {
    return null;
  }

  const provider = providers.get(parsed.providerName);
  if (!provider) {
    return null;
  }

  if (!provider.listModels().some((m) => m.id === parsed.modelId)) {
    return null;
  }

  return {
    provider,
    providerName: parsed.providerName,
    modelId: parsed.modelId,
    publicModelId: toPublicModelId(parsed.providerName, parsed.modelId),
  };
}

function resolveEnabledProviderModel(
  model: string,
  disabledModels: Set<string>,
): ResolvedProviderModel | null {
  const resolved = resolveProviderModel(model);
  if (!resolved) {
    return null;
  }

  if (isModelDisabled(disabledModels, resolved.providerName, resolved.modelId)) {
    return null;
  }

  return resolved;
}

export async function resolveFallbackGroupModel(
  model: string,
  disabledModels?: Set<string>,
): Promise<ResolvedFallbackGroup | null> {
  const disabled = disabledModels ?? (await listDisabledModelKeys());
  const groupId = parseFallbackGroupModelId(model);
  if (!groupId) {
    return null;
  }

  const group = await prisma.fallbackGroup.findUnique({
    where: { id: groupId },
    include: { targets: { orderBy: { position: "asc" } } },
  });

  if (!group?.enabled) {
    return null;
  }

  const targets = group.targets
    .map((target) =>
      resolveEnabledProviderModel(toPublicModelId(target.provider, target.modelId), disabled),
    )
    .filter((target): target is ResolvedProviderModel => Boolean(target));

  if (targets.length === 0) {
    return null;
  }

  return {
    groupId: group.id,
    name: group.name,
    description: group.description,
    publicModelId: toFallbackGroupModelId(group.id),
    targets,
  };
}

export async function resolveChatModel(model: string): Promise<ResolvedChatModel | null> {
  const disabledModels = await listDisabledModelKeys();
  const direct = resolveEnabledProviderModel(model, disabledModels);
  if (direct) {
    return { kind: "direct", requestedModelId: direct.publicModelId, targets: [direct] };
  }

  const fallbackGroup = await resolveFallbackGroupModel(model, disabledModels);
  if (!fallbackGroup) {
    return null;
  }

  return {
    kind: "fallback-group",
    groupId: fallbackGroup.groupId,
    name: fallbackGroup.name,
    description: fallbackGroup.description,
    requestedModelId: fallbackGroup.publicModelId,
    targets: fallbackGroup.targets,
  };
}

export function getProvider(model: string): ProviderAdapter | null {
  return resolveProviderModel(model)?.provider ?? null;
}

export function getProviderByName(name: string): ProviderAdapter | null {
  return providers.get(name) ?? null;
}

export type ResolvedResponseTarget = {
  kind: "direct" | "fallback-group";
  requestedModelId: string;
  target: ResolvedProviderModel;
};

/**
 * Pick the first Responses-capable target for a model id. Accepts:
 *   - a direct provider model id (e.g. `openai:gpt-4o`): returns it if
 *     the underlying adapter advertises `responsesApi: true`.
 *   - a fallback group id (e.g. `mux:fast`): iterates the group's
 *     targets in order and returns the first Responses-capable one.
 *   - anything else, or a model/group with no Responses-capable
 *     targets: returns `null`.
 */
export async function resolveResponseTarget(model: string): Promise<ResolvedResponseTarget | null> {
  const resolved = await resolveChatModel(model);
  if (!resolved) {
    return null;
  }

  if (resolved.kind === "direct") {
    const target = resolved.targets[0];
    if (target.provider.capabilities.responsesApi !== true) {
      return null;
    }
    return {
      kind: "direct",
      requestedModelId: resolved.requestedModelId,
      target,
    };
  }

  for (const target of resolved.targets) {
    if (target.provider.capabilities.responsesApi === true) {
      return {
        kind: "fallback-group",
        requestedModelId: resolved.requestedModelId,
        target,
      };
    }
  }
  return null;
}

export function listAllModels(): Model[] {
  const models: Model[] = [];
  for (const provider of providers.values()) {
    models.push(
      ...provider
        .listModels()
        .map((model) => applyRuntimeCapabilities(model, provider.capabilities)),
    );
  }
  return models;
}

export async function listFallbackGroupModels(disabledModels?: Set<string>): Promise<Model[]> {
  const disabled = disabledModels ?? (await listDisabledModelKeys());
  const groups = await prisma.fallbackGroup.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    include: { targets: { orderBy: { position: "asc" } } },
  });

  const models: Model[] = [];
  for (const group of groups) {
    const targets = group.targets
      .map((target) => {
        const resolved = resolveEnabledProviderModel(
          toPublicModelId(target.provider, target.modelId),
          disabled,
        );
        if (!resolved) return null;
        const sourceModel = resolved.provider.listModels().find((m) => m.id === resolved.modelId);
        const model = sourceModel
          ? applyRuntimeCapabilities(sourceModel, resolved.provider.capabilities)
          : null;
        if (!model) return null;
        return { resolved, model, position: target.position };
      })
      .filter(
        (
          target,
        ): target is {
          resolved: ResolvedProviderModel;
          model: Model;
          position: number;
        } => Boolean(target),
      );

    const primary = targets[0];
    if (!primary) continue;

    models.push({
      ...primary.model,
      id: group.id,
      name: group.name,
      provider: FALLBACK_GROUP_PROVIDER,
      type: "fallback-group",
      fallbackTargets: targets.map(({ resolved, position }) => ({
        provider: resolved.providerName,
        modelId: resolved.modelId,
        publicModelId: resolved.publicModelId,
        position,
      })),
    });
  }

  return models;
}

export async function listPublicModels(): Promise<Model[]> {
  const disabledModels = await listDisabledModelKeys();
  const providerModels = listAllModels().filter(
    (model) => !isModelDisabled(disabledModels, model.provider, model.id),
  );
  return [...providerModels, ...(await listFallbackGroupModels(disabledModels))];
}

export function listConfiguredProviders(): string[] {
  return Array.from(providers.keys());
}

/**
 * Returns pricing for a provider-qualified model id. Returns null if the id is
 * not in `provider:model` format, the provider is not configured, or the model
 * is not exposed by that provider.
 */
export function getModelPricing(modelId: string): Model | null {
  const resolved = resolveProviderModel(modelId);
  if (!resolved) return null;
  const model = resolved.provider.listModels().find((m) => m.id === resolved.modelId);
  return model ? applyRuntimeCapabilities(model, resolved.provider.capabilities) : null;
}

/**
 * Computes the estimated cost (in USD) of a request given prompt and
 * completion token counts and the model's per-1M-token pricing.
 *
 * The optional `cachedTokens` argument is accepted so callers can
 * thread `usage.input_tokens_details.cached_tokens` through, but is
 * intentionally ignored today: Mux charges full input price for all
 * input tokens regardless of whether upstream served them from the
 * prompt cache. A future phase may apply a discount; the parameter is
 * already plumbed through so call sites will not need to change.
 */
export function estimateCost(
  modelId: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  cachedTokens?: number,
): number | undefined {
  void cachedTokens;
  const pricing = getModelPricing(modelId);
  if (!pricing) return undefined;
  const p = promptTokens ?? 0;
  const c = completionTokens ?? 0;
  if (p === 0 && c === 0) return undefined;
  return (p / 1_000_000) * pricing.inputPricePer1M + (c / 1_000_000) * pricing.outputPricePer1M;
}
