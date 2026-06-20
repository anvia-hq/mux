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
 * Also falls back to environment variables for any provider that isn't yet in
 * the DB (useful for the very first boot before anyone has visited the UI).
 */
export async function initProviders() {
  const envFallback: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
  };

  // Seed from env first so the gateway works even if the DB hasn't been
  // populated yet. DB-loaded keys override env on top.
  for (const [name, key] of Object.entries(envFallback)) {
    if (key) {
      const adapter = buildAdapter(name, key);
      if (adapter) providers.set(name, adapter);
    }
  }

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
