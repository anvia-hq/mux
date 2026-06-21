import type { ProviderAdapter, Model } from "./types";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { MistralAdapter } from "./mistral";
import { prisma } from "../utils/prisma";
import { decrypt } from "../modules/providers/crypto";

const providers: Map<string, ProviderAdapter> = new Map();

function buildAdapter(provider: string, apiKey: string): ProviderAdapter | null {
  switch (provider) {
    case "openai":
      return new OpenAIAdapter(apiKey);
    case "anthropic":
      return new AnthropicAdapter(apiKey);
    case "google":
      return new GoogleAdapter(apiKey);
    case "mistral":
      return new MistralAdapter(apiKey);
    default:
      return null;
  }
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
    console.warn("ProviderKey table not available yet:", error instanceof Error ? error.message : error);
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
  }
}

export function getProvider(model: string): ProviderAdapter | null {
  // Match model name to provider
  if (model.startsWith("gpt-")) return providers.get("openai") ?? null;
  if (model.startsWith("claude-")) return providers.get("anthropic") ?? null;
  if (model.startsWith("gemini-")) return providers.get("google") ?? null;
  if (model.startsWith("mistral-")) return providers.get("mistral") ?? null;

  return null;
}

export function listAllModels(): Model[] {
  const models: Model[] = [];
  for (const provider of providers.values()) {
    models.push(...provider.listModels());
  }
  return models;
}

export function listConfiguredProviders(): string[] {
  return Array.from(providers.keys());
}

/**
 * Returns the pricing for a specific model id by searching all configured
 * providers' model lists. Returns null if the model is unknown.
 */
export function getModelPricing(modelId: string): Model | null {
  for (const provider of providers.values()) {
    const found = provider.listModels().find((m) => m.id === modelId);
    if (found) return found;
  }
  return null;
}

/**
 * Computes the estimated cost (in USD) of a request given prompt and
 * completion token counts and the model's per-1M-token pricing.
 */
export function estimateCost(
  modelId: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number | undefined {
  const pricing = getModelPricing(modelId);
  if (!pricing) return undefined;
  const p = promptTokens ?? 0;
  const c = completionTokens ?? 0;
  if (p === 0 && c === 0) return undefined;
  return (p / 1_000_000) * pricing.inputPricePer1M + (c / 1_000_000) * pricing.outputPricePer1M;
}
