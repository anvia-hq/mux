import type {
  AnthropicMessageCountTokensRequest,
  AnthropicMessageCreateRequest,
  AnthropicMessageObject,
  AnthropicMessageTokenCountObject,
  AudioMultipartRequest,
  AudioProxyResponse,
  AudioProxyStreamResponse,
  AudioSpeechRequest,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  Model,
  ModelPricingTier,
  ModerationRequest,
  ModerationResponse,
  ProviderAdapter,
  ProviderRequestOptions,
} from "./types";
import { RequestyAdapter } from "./requesty";
import { QiniuAiAdapter } from "./qiniu-ai";
import { AlibabaCnAdapter } from "./alibaba-cn";
import { RegoloAiAdapter } from "./regolo-ai";
import { StackitAdapter } from "./stackit";
import { VercelAdapter } from "./vercel";
import { SubmodelAdapter } from "./submodel";
import { SumopodAdapter } from "./sumopod";
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
import { CustomOpenAICompatibleAdapter } from "./custom-openai-compatible";
import { prisma } from "../utils/prisma";
import { decrypt } from "../modules/providers/crypto";
import { applyRuntimeCapabilities } from "./chat-compat";
import {
  normalizeChannelOtherSettings,
  normalizeChannelSettings,
  normalizeJsonObject,
  normalizeStringMap,
  type ChannelOtherSettings,
  type ChannelSettings,
} from "./channel-settings";

const providerChannels: Map<string, RuntimeProviderChannel> = new Map();
export const FALLBACK_GROUP_PROVIDER = "mux";

const adapterFactories: Record<string, (apiKey: string) => ProviderAdapter | null> = {
  requesty: (apiKey) => new RequestyAdapter(apiKey),
  "qiniu-ai": (apiKey) => new QiniuAiAdapter(apiKey),
  "alibaba-cn": (apiKey) => new AlibabaCnAdapter(apiKey),
  "regolo-ai": (apiKey) => new RegoloAiAdapter(apiKey),
  stackit: (apiKey) => new StackitAdapter(apiKey),
  vercel: (apiKey) => new VercelAdapter(apiKey),
  submodel: (apiKey) => new SubmodelAdapter(apiKey),
  sumopod: (apiKey) => new SumopodAdapter(apiKey),
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

type CustomProviderWithModels = {
  id: string;
  name: string;
  apiBase: string;
  responsesMode: "DISABLED" | "NATIVE" | "VIA_CHAT";
  responsesEndpoint: string | null;
  models: Array<{
    modelId: string;
    name: string;
    inputPricePer1M: number;
    outputPricePer1M: number;
    pricingTiers?: unknown;
    contextWindow: number;
    maxOutputTokens: number;
    inputModalities: string[];
    outputModalities: string[];
    reasoning: boolean;
    toolCall: boolean;
    structuredOutput: boolean;
    weights: string;
  }>;
};

type ProviderChannelRow = {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  priority: number;
  weight: number;
  keyCiphertext: string;
  modelMapping?: unknown;
  settings?: unknown;
  otherSettings?: unknown;
  paramOverride?: unknown;
  headerOverride?: unknown;
};

export type RuntimeProviderChannel = {
  id: string;
  name: string;
  providerName: string;
  priority: number;
  weight: number;
  apiKey: string;
  provider: ProviderAdapter;
  modelMapping: Record<string, string>;
  settings?: ChannelSettings;
  otherSettings?: ChannelOtherSettings;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, unknown>;
};

function buildCustomAdapter(row: CustomProviderWithModels, apiKey: string): ProviderAdapter {
  return new CustomOpenAICompatibleAdapter({
    name: row.id,
    apiKey,
    apiBase: row.apiBase,
    responsesMode:
      row.responsesMode === "NATIVE"
        ? "native"
        : row.responsesMode === "VIA_CHAT"
          ? "via_chat"
          : "disabled",
    responsesEndpoint: row.responsesEndpoint ?? undefined,
    models: row.models.map((model) => ({
      id: model.modelId,
      name: model.name,
      provider: row.id,
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
      pricingTiers: readPricingTiers(model.pricingTiers),
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      reasoning: model.reasoning,
      toolCall: model.toolCall,
      structuredOutput: model.structuredOutput,
      weights: model.weights === "open" ? "open" : "closed",
    })),
  });
}

function readPricingTiers(value: unknown): ModelPricingTier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiers = value.filter(
    (tier): tier is ModelPricingTier =>
      Boolean(tier) &&
      typeof tier === "object" &&
      typeof (tier as ModelPricingTier).inputTokenThreshold === "number" &&
      typeof (tier as ModelPricingTier).inputPricePer1M === "number" &&
      typeof (tier as ModelPricingTier).outputPricePer1M === "number",
  );
  return tiers.length
    ? tiers.sort((left, right) => left.inputTokenThreshold - right.inputTokenThreshold)
    : undefined;
}

function buildAdapter(
  provider: string,
  apiKey: string,
  customProvider?: CustomProviderWithModels,
): ProviderAdapter | null {
  const builtInAdapter = adapterFactories[provider]?.(apiKey) ?? null;
  if (builtInAdapter) return builtInAdapter;
  return customProvider ? buildCustomAdapter(customProvider, apiKey) : null;
}

function compareChannels(a: RuntimeProviderChannel, b: RuntimeProviderChannel): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.weight !== b.weight) return b.weight - a.weight;
  return a.id.localeCompare(b.id);
}

function buildRuntimeChannel(
  row: ProviderChannelRow,
  customProvider?: CustomProviderWithModels,
): RuntimeProviderChannel | null {
  const apiKey = decrypt(row.keyCiphertext);
  const adapter = buildAdapter(row.provider, apiKey, customProvider);
  if (!adapter) return null;

  return {
    id: row.id,
    name: row.name,
    providerName: row.provider,
    priority: row.priority,
    weight: row.weight,
    apiKey,
    provider: adapter,
    modelMapping: normalizeStringMap(row.modelMapping),
    settings: normalizeChannelSettings(row.settings),
    otherSettings: normalizeChannelOtherSettings(row.otherSettings),
    paramOverride: normalizeJsonObject(row.paramOverride),
    headerOverride: normalizeJsonObject(row.headerOverride),
  };
}

async function loadCustomProvidersById(): Promise<Map<string, CustomProviderWithModels>> {
  try {
    const customProviders = await prisma.customProvider.findMany({
      include: { models: { orderBy: { name: "asc" } } },
    });
    return new Map(customProviders.map((provider) => [provider.id, provider]));
  } catch (error) {
    console.warn(
      "CustomProvider table not available yet:",
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
}

async function loadChannelRowsForProvider(provider?: string): Promise<ProviderChannelRow[]> {
  const rows = await prisma.providerChannel.findMany({
    where: { ...(provider ? { provider } : {}), enabled: true },
    orderBy: [{ priority: "desc" }, { weight: "desc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    weight: row.weight,
    keyCiphertext: row.keyCiphertext,
    modelMapping: row.modelMapping,
    settings: row.settings,
    otherSettings: row.otherSettings,
    paramOverride: row.paramOverride,
    headerOverride: row.headerOverride,
  }));
}

async function loadLegacyProviderKeyRows(provider?: string): Promise<ProviderChannelRow[]> {
  const rows = provider
    ? await prisma.providerKey.findMany({ where: { provider } })
    : await prisma.providerKey.findMany();

  return rows.map((row) => ({
    id: row.provider,
    provider: row.provider,
    name: row.provider,
    enabled: true,
    priority: 0,
    weight: 1,
    keyCiphertext: row.ciphertext,
  }));
}

function channelsForProvider(providerName: string): RuntimeProviderChannel[] {
  return Array.from(providerChannels.values())
    .filter((channel) => channel.providerName === providerName)
    .sort(compareChannels);
}

function sourceModelForTarget(target: ResolvedProviderModel): Model | null {
  const upstreamModelId = target.upstreamModelId ?? target.modelId;
  return target.provider.listModels().find((model) => model.id === upstreamModelId) ?? null;
}

/**
 * Reads provider keys from the database and seeds the in-memory adapter cache.
 * Provider keys are NEVER read from environment variables — they are stored
 * encrypted at rest and managed exclusively via the dashboard / providers API.
 */
export async function initProviders() {
  providerChannels.clear();

  try {
    const rows = await loadChannelRowsForProvider();
    const customProvidersById = await loadCustomProvidersById();

    for (const row of rows) {
      const channel = buildRuntimeChannel(row, customProvidersById.get(row.provider));
      if (channel) providerChannels.set(channel.id, channel);
    }
  } catch (error) {
    console.warn(
      "ProviderChannel table not available yet:",
      error instanceof Error ? error.message : error,
    );
    try {
      const customProvidersById = await loadCustomProvidersById();
      const rows = await loadLegacyProviderKeyRows();
      for (const row of rows) {
        const channel = buildRuntimeChannel(row, customProvidersById.get(row.provider));
        if (channel) providerChannels.set(channel.id, channel);
      }
    } catch (legacyError) {
      console.warn(
        "ProviderKey table not available yet:",
        legacyError instanceof Error ? legacyError.message : legacyError,
      );
    }
  }

  console.log(
    `Initialized provider channels: ${Array.from(providerChannels.keys()).join(", ") || "(none)"}`,
  );
}

/**
 * Loads a single provider from the database, replacing any cached instance.
 * Called after PUT/DELETE on the providers API so changes apply immediately.
 */
export async function reloadProvider(name: string): Promise<void> {
  for (const [channelId, channel] of providerChannels) {
    if (channel.providerName === name) {
      providerChannels.delete(channelId);
    }
  }

  try {
    const rows = await loadChannelRowsForProvider(name);
    let customProvider: CustomProviderWithModels | null = null;
    if (!adapterFactories[name]) {
      customProvider = await prisma.customProvider.findUnique({
        where: { id: name },
        include: { models: { orderBy: { name: "asc" } } },
      });
    }
    for (const row of rows) {
      const channel = buildRuntimeChannel(row, customProvider ?? undefined);
      if (channel) providerChannels.set(channel.id, channel);
    }
  } catch (error) {
    console.warn(
      "ProviderChannel table not available yet:",
      error instanceof Error ? error.message : error,
    );
    const rows = await loadLegacyProviderKeyRows(name);
    let customProvider: CustomProviderWithModels | null = null;
    if (!adapterFactories[name]) {
      customProvider = await prisma.customProvider.findUnique({
        where: { id: name },
        include: { models: { orderBy: { name: "asc" } } },
      });
    }
    for (const row of rows) {
      const channel = buildRuntimeChannel(row, customProvider ?? undefined);
      if (channel) providerChannels.set(channel.id, channel);
    }
  }
}

export async function reloadProviderChannel(channelId: string): Promise<void> {
  providerChannels.delete(channelId);

  const row = await prisma.providerChannel.findUnique({ where: { id: channelId } });
  if (!row?.enabled) {
    return;
  }

  let customProvider: CustomProviderWithModels | null = null;
  if (!adapterFactories[row.provider]) {
    customProvider = await prisma.customProvider.findUnique({
      where: { id: row.provider },
      include: { models: { orderBy: { name: "asc" } } },
    });
  }

  const channel = buildRuntimeChannel(
    {
      id: row.id,
      provider: row.provider,
      name: row.name,
      enabled: row.enabled,
      priority: row.priority,
      weight: row.weight,
      keyCiphertext: row.keyCiphertext,
      modelMapping: row.modelMapping,
      settings: row.settings,
      otherSettings: row.otherSettings,
      paramOverride: row.paramOverride,
      headerOverride: row.headerOverride,
    },
    customProvider ?? undefined,
  );
  if (channel) providerChannels.set(channel.id, channel);
}

export function clearProviderCacheForE2e(): void {
  providerChannels.clear();
}

export type ResolvedProviderModel = {
  provider: ProviderAdapter;
  providerName: string;
  channelId: string;
  channelName: string;
  modelId: string;
  upstreamModelId: string;
  publicModelId: string;
  settings?: ChannelSettings;
  otherSettings?: ChannelOtherSettings;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, unknown>;
  apiKey?: string;
  priority?: number;
  weight?: number;
  fallbackPosition?: number;
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
      targets: ResolvedProviderModel[];
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

export function toPublicModelIdForModel(model: Pick<Model, "id" | "provider" | "type">): string {
  if (model.type === "alias") {
    return model.id;
  }
  return toPublicModelId(model.provider, model.id);
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
  return resolveProviderModelTargets(model)[0] ?? null;
}

function resolveProviderModelTargets(model: string): ResolvedProviderModel[] {
  const parsed = parsePublicModelId(model);
  if (!parsed) {
    return [];
  }

  const resolved: ResolvedProviderModel[] = [];
  for (const channel of channelsForProvider(parsed.providerName)) {
    const upstreamModelId = channel.modelMapping[parsed.modelId] ?? parsed.modelId;
    if (!channel.provider.listModels().some((m) => m.id === upstreamModelId)) {
      continue;
    }
    resolved.push({
      provider: channel.provider,
      providerName: parsed.providerName,
      channelId: channel.id,
      channelName: channel.name,
      modelId: parsed.modelId,
      upstreamModelId,
      publicModelId: toPublicModelId(parsed.providerName, parsed.modelId),
      settings: channel.settings,
      otherSettings: channel.otherSettings,
      paramOverride: channel.paramOverride,
      headerOverride: channel.headerOverride,
      apiKey: channel.apiKey,
      priority: channel.priority,
      weight: channel.weight,
    });
  }
  return resolved;
}

function resolveEnabledProviderModel(
  model: string,
  disabledModels: Set<string>,
): ResolvedProviderModel[] {
  return resolveProviderModelTargets(model).filter(
    (resolved) => !isModelDisabled(disabledModels, resolved.providerName, resolved.modelId),
  );
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

  const targets = group.targets.flatMap((target) =>
    resolveEnabledProviderModel(toPublicModelId(target.provider, target.modelId), disabled).map(
      (resolved) => ({ ...resolved, fallbackPosition: target.position }),
    ),
  );

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

async function resolveBaseChatModel(
  model: string,
  disabledModels: Set<string>,
): Promise<ResolvedChatModel | null> {
  const direct = resolveEnabledProviderModel(model, disabledModels);
  if (direct.length > 0) {
    return { kind: "direct", requestedModelId: direct[0].publicModelId, targets: direct };
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

async function resolveAliasChatModel(
  model: string,
  disabledModels: Set<string>,
): Promise<ResolvedChatModel | null> {
  if (model.includes(":")) {
    return null;
  }

  const alias = await prisma.modelAlias.findUnique({
    where: { id: model },
    select: { id: true, enabled: true, targetModelId: true },
  });

  if (!alias?.enabled) {
    return null;
  }

  const resolved = await resolveBaseChatModel(alias.targetModelId, disabledModels);
  if (!resolved) {
    return null;
  }

  if (resolved.kind === "direct") {
    return { ...resolved, requestedModelId: alias.id };
  }

  return { ...resolved, requestedModelId: alias.id };
}

export async function resolveChatModel(model: string): Promise<ResolvedChatModel | null> {
  const disabledModels = await listDisabledModelKeys();
  const base = await resolveBaseChatModel(model, disabledModels);
  if (base) {
    return base;
  }

  return resolveAliasChatModel(model, disabledModels);
}

export function getProvider(model: string): ProviderAdapter | null {
  return resolveProviderModel(model)?.provider ?? null;
}

export function getProviderByName(name: string): ProviderAdapter | null {
  return channelsForProvider(name)[0]?.provider ?? null;
}

export function getProviderByChannelId(channelId: string): ProviderAdapter | null {
  return providerChannels.get(channelId)?.provider ?? null;
}

export function getProviderForChannel(
  providerName: string,
  channelId?: string | null,
): ProviderAdapter | null {
  if (channelId) {
    const channel = providerChannels.get(channelId);
    if (channel?.providerName === providerName) {
      return channel.provider;
    }
  }
  return getProviderByName(providerName);
}

export function getProviderChannelRuntime(
  providerName: string,
  channelId?: string | null,
): RuntimeProviderChannel | null {
  if (channelId) {
    const channel = providerChannels.get(channelId);
    if (channel?.providerName === providerName) {
      return channel;
    }
  }
  return channelsForProvider(providerName)[0] ?? null;
}

export function getProvidersByName(name: string): ProviderAdapter[] {
  return channelsForProvider(name).map((channel) => channel.provider);
}

export type ResolvedResponseTarget = {
  kind: "direct" | "fallback-group";
  requestedModelId: string;
  target: ResolvedProviderModel;
};

export type ResolvedResponseTargets = {
  kind: "direct" | "fallback-group";
  requestedModelId: string;
  targets: ResolvedProviderModel[];
};

export type ResolvedEmbeddingProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createEmbedding: (
      request: EmbeddingRequest,
      options?: ProviderRequestOptions,
    ) => Promise<EmbeddingResponse>;
  };
};

type ResolvedEndpointModel<TTarget extends ResolvedProviderModel> =
  | {
      kind: "direct";
      requestedModelId: string;
      targets: [TTarget, ...TTarget[]];
    }
  | {
      kind: "fallback-group";
      groupId: string;
      name: string;
      description: string | null;
      requestedModelId: string;
      targets: TTarget[];
    };

export type ResolvedEmbeddingModel = ResolvedEndpointModel<ResolvedEmbeddingProviderModel>;

function isEmbeddingCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedEmbeddingProviderModel {
  return (
    target.provider.capabilities.embeddingsApi === true &&
    typeof target.provider.createEmbedding === "function"
  );
}

export async function resolveEmbeddingModel(model: string): Promise<ResolvedEmbeddingModel | null> {
  return resolveEndpointModel(model, isEmbeddingCapableTarget, { allDirectTargets: true });
}

export async function resolveEmbeddingAccessModelId(model: string): Promise<string> {
  return (await resolveEmbeddingModel(model))?.requestedModelId ?? model;
}

export type ResolvedModerationProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createModeration: (
      request: ModerationRequest,
      options?: ProviderRequestOptions,
    ) => Promise<ModerationResponse>;
  };
};

export type ResolvedModerationModel = ResolvedEndpointModel<ResolvedModerationProviderModel>;

export type ResolvedImageGenerationProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createImageGeneration: (
      request: ImageGenerationRequest,
      options?: ProviderRequestOptions,
    ) => Promise<ImageGenerationResponse>;
    createImageGenerationStream?: (
      request: ImageGenerationRequest,
      options?: ProviderRequestOptions,
    ) => AsyncIterable<string>;
  };
};

export type ResolvedImageGenerationModel =
  ResolvedEndpointModel<ResolvedImageGenerationProviderModel>;

export type ResolvedCompletionProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createCompletion: (
      request: CompletionRequest,
      options?: ProviderRequestOptions,
    ) => Promise<CompletionResponse>;
    createCompletionStream?: (
      request: CompletionRequest,
      options?: ProviderRequestOptions,
    ) => AsyncIterable<string>;
  };
};

export type ResolvedCompletionModel = ResolvedEndpointModel<ResolvedCompletionProviderModel>;

export type ResolvedAudioTranscriptionProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAudioTranscription: (request: AudioMultipartRequest) => Promise<AudioProxyResponse>;
  };
};

export type ResolvedAudioTranscriptionModel =
  ResolvedEndpointModel<ResolvedAudioTranscriptionProviderModel>;

export type ResolvedAudioTranscriptionStreamProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAudioTranscriptionStream: (
      request: AudioMultipartRequest,
    ) => Promise<AudioProxyStreamResponse>;
  };
};

export type ResolvedAudioTranscriptionStreamModel =
  ResolvedEndpointModel<ResolvedAudioTranscriptionStreamProviderModel>;

export type ResolvedAudioTranslationProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAudioTranslation: (request: AudioMultipartRequest) => Promise<AudioProxyResponse>;
  };
};

export type ResolvedAudioTranslationModel =
  ResolvedEndpointModel<ResolvedAudioTranslationProviderModel>;

export type ResolvedAudioSpeechProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAudioSpeech: (request: AudioSpeechRequest) => Promise<AudioProxyResponse>;
  };
};

export type ResolvedAudioSpeechModel = ResolvedEndpointModel<ResolvedAudioSpeechProviderModel>;

export type ResolvedAudioSpeechStreamProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAudioSpeechStream: (request: AudioSpeechRequest) => Promise<AudioProxyStreamResponse>;
  };
};

export type ResolvedAudioSpeechStreamModel =
  ResolvedEndpointModel<ResolvedAudioSpeechStreamProviderModel>;

export type ResolvedAnthropicMessagesProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    createAnthropicMessage: (
      request: AnthropicMessageCreateRequest,
      options?: ProviderRequestOptions,
    ) => Promise<AnthropicMessageObject>;
    createAnthropicMessageStream?: (
      request: AnthropicMessageCreateRequest,
      options?: ProviderRequestOptions,
    ) => AsyncIterable<string>;
  };
};

export type ResolvedAnthropicMessagesModel =
  ResolvedEndpointModel<ResolvedAnthropicMessagesProviderModel>;

export type ResolvedAnthropicMessageTokenCountProviderModel = ResolvedProviderModel & {
  provider: ProviderAdapter & {
    countAnthropicMessageTokens: (
      request: AnthropicMessageCountTokensRequest,
      options?: ProviderRequestOptions,
    ) => Promise<AnthropicMessageTokenCountObject>;
  };
};

export type ResolvedAnthropicMessageTokenCountModel =
  ResolvedEndpointModel<ResolvedAnthropicMessageTokenCountProviderModel>;

type EndpointCapability =
  | "moderationsApi"
  | "imageGenerationsApi"
  | "completionsApi"
  | "audioTranscriptionsApi"
  | "audioTranslationsApi"
  | "audioSpeechApi"
  | "anthropicMessagesApi"
  | "anthropicMessageTokenCountingApi";

function isEndpointCapableTarget<TMethod extends keyof ProviderAdapter>(
  target: ResolvedProviderModel,
  capability: EndpointCapability,
  method: TMethod,
): boolean {
  return (
    target.provider.capabilities[capability] === true &&
    typeof target.provider[method] === "function"
  );
}

function isModerationCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedModerationProviderModel {
  return isEndpointCapableTarget(target, "moderationsApi", "createModeration");
}

function isImageGenerationCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedImageGenerationProviderModel {
  return isEndpointCapableTarget(target, "imageGenerationsApi", "createImageGeneration");
}

function isCompletionCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedCompletionProviderModel {
  return isEndpointCapableTarget(target, "completionsApi", "createCompletion");
}

function isAudioTranscriptionCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAudioTranscriptionProviderModel {
  return isEndpointCapableTarget(target, "audioTranscriptionsApi", "createAudioTranscription");
}

function isAudioTranscriptionStreamCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAudioTranscriptionStreamProviderModel {
  return isEndpointCapableTarget(
    target,
    "audioTranscriptionsApi",
    "createAudioTranscriptionStream",
  );
}

function isAudioTranslationCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAudioTranslationProviderModel {
  if (!isEndpointCapableTarget(target, "audioTranslationsApi", "createAudioTranslation")) {
    return false;
  }

  return target.providerName !== "openai" || target.upstreamModelId === "whisper-1";
}

function isAudioSpeechCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAudioSpeechProviderModel {
  return isEndpointCapableTarget(target, "audioSpeechApi", "createAudioSpeech");
}

function isAudioSpeechStreamCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAudioSpeechStreamProviderModel {
  return isEndpointCapableTarget(target, "audioSpeechApi", "createAudioSpeechStream");
}

function isAnthropicMessagesCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAnthropicMessagesProviderModel {
  return isEndpointCapableTarget(target, "anthropicMessagesApi", "createAnthropicMessage");
}

function isAnthropicMessageTokenCountCapableTarget(
  target: ResolvedProviderModel,
): target is ResolvedAnthropicMessageTokenCountProviderModel {
  return isEndpointCapableTarget(
    target,
    "anthropicMessageTokenCountingApi",
    "countAnthropicMessageTokens",
  );
}

async function resolveEndpointModel<TTarget extends ResolvedProviderModel>(
  model: string,
  isCapableTarget: (target: ResolvedProviderModel) => target is TTarget,
  options: { allDirectTargets?: boolean } = {},
): Promise<ResolvedEndpointModel<TTarget> | null> {
  const resolved = await resolveChatModel(model);
  if (!resolved) {
    return null;
  }

  if (resolved.kind === "direct") {
    const targets = options.allDirectTargets
      ? resolved.targets.filter(isCapableTarget)
      : resolved.targets[0] && isCapableTarget(resolved.targets[0])
        ? [resolved.targets[0]]
        : [];
    if (targets.length === 0) {
      return null;
    }
    return {
      kind: "direct",
      requestedModelId: resolved.requestedModelId,
      targets: targets as [TTarget, ...TTarget[]],
    };
  }

  const targets = resolved.targets.filter(isCapableTarget);
  if (targets.length === 0) {
    return null;
  }

  return {
    kind: "fallback-group",
    groupId: resolved.groupId,
    name: resolved.name,
    description: resolved.description,
    requestedModelId: resolved.requestedModelId,
    targets,
  };
}

export async function resolveModerationModel(
  model: string,
): Promise<ResolvedModerationModel | null> {
  return resolveEndpointModel(model, isModerationCapableTarget);
}

export async function resolveImageGenerationModel(
  model: string,
): Promise<ResolvedImageGenerationModel | null> {
  return resolveEndpointModel(model, isImageGenerationCapableTarget);
}

export async function resolveCompletionModel(
  model: string,
): Promise<ResolvedCompletionModel | null> {
  return resolveEndpointModel(model, isCompletionCapableTarget);
}

export async function resolveAudioTranscriptionModel(
  model: string,
): Promise<ResolvedAudioTranscriptionModel | null> {
  return resolveEndpointModel(model, isAudioTranscriptionCapableTarget);
}

export async function resolveAudioTranscriptionStreamModel(
  model: string,
): Promise<ResolvedAudioTranscriptionStreamModel | null> {
  return resolveEndpointModel(model, isAudioTranscriptionStreamCapableTarget);
}

export async function resolveAudioTranslationModel(
  model: string,
): Promise<ResolvedAudioTranslationModel | null> {
  return resolveEndpointModel(model, isAudioTranslationCapableTarget);
}

export async function resolveAudioSpeechModel(
  model: string,
): Promise<ResolvedAudioSpeechModel | null> {
  return resolveEndpointModel(model, isAudioSpeechCapableTarget);
}

export async function resolveAudioSpeechStreamModel(
  model: string,
): Promise<ResolvedAudioSpeechStreamModel | null> {
  return resolveEndpointModel(model, isAudioSpeechStreamCapableTarget);
}

export async function resolveAnthropicMessagesModel(
  model: string,
): Promise<ResolvedAnthropicMessagesModel | null> {
  if (model.includes(":")) {
    return resolveEndpointModel(model, isAnthropicMessagesCapableTarget, {
      allDirectTargets: true,
    });
  }

  const directAnthropic = await resolveEndpointModel(
    toPublicModelId("anthropic", model),
    isAnthropicMessagesCapableTarget,
    { allDirectTargets: true },
  );
  if (directAnthropic) {
    return directAnthropic;
  }

  return resolveEndpointModel(model, isAnthropicMessagesCapableTarget, {
    allDirectTargets: true,
  });
}

export async function resolveAnthropicMessagesAccessModelId(model: string): Promise<string> {
  const resolved = await resolveAnthropicMessagesModel(model);
  if (resolved) {
    return resolved.requestedModelId;
  }
  return model.includes(":") ? model : toPublicModelId("anthropic", model);
}

export async function resolveAnthropicMessageTokenCountModel(
  model: string,
): Promise<ResolvedAnthropicMessageTokenCountModel | null> {
  if (model.includes(":")) {
    return resolveEndpointModel(model, isAnthropicMessageTokenCountCapableTarget, {
      allDirectTargets: true,
    });
  }

  const directAnthropic = await resolveEndpointModel(
    toPublicModelId("anthropic", model),
    isAnthropicMessageTokenCountCapableTarget,
    { allDirectTargets: true },
  );
  if (directAnthropic) {
    return directAnthropic;
  }

  return resolveEndpointModel(model, isAnthropicMessageTokenCountCapableTarget, {
    allDirectTargets: true,
  });
}

export async function resolveAnthropicMessageTokenCountAccessModelId(
  model: string,
): Promise<string> {
  const resolved = await resolveAnthropicMessageTokenCountModel(model);
  if (resolved) {
    return resolved.requestedModelId;
  }
  return model.includes(":") ? model : toPublicModelId("anthropic", model);
}

export async function resolveResponseTargets(
  model: string,
): Promise<ResolvedResponseTargets | null> {
  const resolved = await resolveChatModel(model);
  if (!resolved) return null;
  const targets = resolved.targets.filter((target) =>
    Boolean(target.provider.capabilities.responsesTransport),
  );
  return targets.length > 0
    ? { kind: resolved.kind, requestedModelId: resolved.requestedModelId, targets }
    : null;
}

export async function resolveResponseTarget(model: string): Promise<ResolvedResponseTarget | null> {
  const resolved = await resolveResponseTargets(model);
  const target = resolved?.targets[0];
  return resolved && target
    ? { kind: resolved.kind, requestedModelId: resolved.requestedModelId, target }
    : null;
}

export function listAllModels(): Model[] {
  const modelsByPublicId = new Map<string, Model>();
  const channels = Array.from(providerChannels.values()).sort(compareChannels);

  for (const channel of channels) {
    const upstreamModels = new Map(channel.provider.listModels().map((model) => [model.id, model]));
    const candidateModels = channel.provider.listModels().map((model) => ({
      source: model,
      publicModelId: model.id,
    }));

    for (const [publicModelId, upstreamModelId] of Object.entries(channel.modelMapping)) {
      const source = upstreamModels.get(upstreamModelId);
      if (source) {
        candidateModels.push({ source, publicModelId });
      }
    }

    for (const { source, publicModelId } of candidateModels) {
      const publicId = toPublicModelId(channel.providerName, publicModelId);
      if (modelsByPublicId.has(publicId)) continue;

      const model = applyRuntimeCapabilities(source, channel.provider.capabilities);
      modelsByPublicId.set(publicId, {
        ...model,
        id: publicModelId,
        provider: channel.providerName,
      });
    }
  }

  return Array.from(modelsByPublicId.values());
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
      .flatMap((target) => {
        const resolvedTargets = resolveEnabledProviderModel(
          toPublicModelId(target.provider, target.modelId),
          disabled,
        );
        return resolvedTargets
          .map((resolved) => {
            const sourceModel = sourceModelForTarget(resolved);
            const model = sourceModel
              ? applyRuntimeCapabilities(sourceModel, resolved.provider.capabilities)
              : null;
            if (!model) return null;
            return { resolved, model, position: target.position };
          })
          .filter(
            (
              resolved,
            ): resolved is {
              resolved: ResolvedProviderModel;
              model: Model;
              position: number;
            } => Boolean(resolved),
          );
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

export async function listPublicNonAliasModels(disabledModels?: Set<string>): Promise<Model[]> {
  const disabled = disabledModels ?? (await listDisabledModelKeys());
  const providerModels = listAllModels().filter(
    (model) => !isModelDisabled(disabled, model.provider, model.id),
  );
  return [...providerModels, ...(await listFallbackGroupModels(disabled))];
}

export async function listModelAliasModels(baseModels?: Model[]): Promise<Model[]> {
  const resolvedBaseModels = baseModels ?? (await listPublicNonAliasModels());
  const modelsByPublicId = new Map(
    resolvedBaseModels.map((model) => [toPublicModelIdForModel(model), model]),
  );
  const aliases = await prisma.modelAlias.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      targetModelId: true,
    },
  });

  const models: Model[] = [];
  for (const alias of aliases) {
    const target = modelsByPublicId.get(alias.targetModelId);
    if (!target) continue;

    models.push({
      ...target,
      id: alias.id,
      name: alias.name,
      provider: FALLBACK_GROUP_PROVIDER,
      type: "alias",
      aliasTargetModelId: alias.targetModelId,
    });
  }

  return models;
}

export async function listPublicModels(): Promise<Model[]> {
  const disabledModels = await listDisabledModelKeys();
  const baseModels = await listPublicNonAliasModels(disabledModels);
  const aliasModels = await listModelAliasModels(baseModels);
  const aliasedTargetIds = new Set(
    aliasModels
      .map((model) => model.aliasTargetModelId)
      .filter((modelId): modelId is string => Boolean(modelId)),
  );
  const visibleBaseModels = baseModels.filter(
    (model) => !aliasedTargetIds.has(toPublicModelIdForModel(model)),
  );
  return [...visibleBaseModels, ...aliasModels];
}

export function listConfiguredProviders(): string[] {
  return Array.from(
    new Set(Array.from(providerChannels.values()).map((channel) => channel.providerName)),
  );
}

/**
 * Returns pricing for a provider-qualified model id. Returns null if the id is
 * not in `provider:model` format, the provider is not configured, or the model
 * is not exposed by that provider.
 */
export function getModelPricing(modelId: string): Model | null {
  const resolved = resolveProviderModel(modelId);
  if (!resolved) return null;
  const model = sourceModelForTarget(resolved);
  if (!model) return null;
  return {
    ...applyRuntimeCapabilities(model, resolved.provider.capabilities),
    id: resolved.modelId,
    provider: resolved.providerName,
  };
}

export type CostEstimateDetails = {
  estimatedCost: number;
  pricingInputTokens: number;
  appliedInputPricePer1M: number;
  appliedOutputPricePer1M: number;
  appliedPricingTierThreshold: number | null;
};

export function selectModelPricingRates(
  pricing: Pick<Model, "inputPricePer1M" | "outputPricePer1M" | "pricingTiers">,
  pricingInputTokens: number,
) {
  const selectedTier = [...(pricing.pricingTiers ?? [])]
    .sort((left, right) => left.inputTokenThreshold - right.inputTokenThreshold)
    .filter((tier) => pricingInputTokens > tier.inputTokenThreshold)
    .at(-1);
  return {
    inputPricePer1M: selectedTier?.inputPricePer1M ?? pricing.inputPricePer1M,
    outputPricePer1M: selectedTier?.outputPricePer1M ?? pricing.outputPricePer1M,
    threshold: selectedTier?.inputTokenThreshold ?? null,
  };
}

/**
 * Computes cost and records the exact tier selected for a request. Pricing tiers
 * are whole-request tiers: once crossed, both input and output use that tier.
 */
export function estimateCostDetails(
  modelId: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  pricingInputTokens = promptTokens,
): CostEstimateDetails | undefined {
  const pricing = getModelPricing(modelId);
  if (!pricing) return undefined;

  const inputTokens = promptTokens ?? 0;
  const outputTokens = completionTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;

  const selectorTokens = pricingInputTokens ?? inputTokens;
  const selectedRates = selectModelPricingRates(pricing, selectorTokens);
  const appliedInputPricePer1M = selectedRates.inputPricePer1M;
  const appliedOutputPricePer1M = selectedRates.outputPricePer1M;

  return {
    estimatedCost:
      (inputTokens / 1_000_000) * appliedInputPricePer1M +
      (outputTokens / 1_000_000) * appliedOutputPricePer1M,
    pricingInputTokens: selectorTokens,
    appliedInputPricePer1M,
    appliedOutputPricePer1M,
    appliedPricingTierThreshold: selectedRates.threshold,
  };
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
  pricingInputTokens?: number,
): number | undefined {
  void cachedTokens;
  return estimateCostDetails(modelId, promptTokens, completionTokens, pricingInputTokens)
    ?.estimatedCost;
}
