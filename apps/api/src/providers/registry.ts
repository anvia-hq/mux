import type { ProviderAdapter, Model } from "./types";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { MistralAdapter } from "./mistral";

const providers: Map<string, ProviderAdapter> = new Map();

export function initProviders() {
  if (process.env.OPENAI_API_KEY) {
    providers.set("openai", new OpenAIAdapter(process.env.OPENAI_API_KEY));
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.set("anthropic", new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  }

  if (process.env.GOOGLE_API_KEY) {
    providers.set("google", new GoogleAdapter(process.env.GOOGLE_API_KEY));
  }

  if (process.env.MISTRAL_API_KEY) {
    providers.set("mistral", new MistralAdapter(process.env.MISTRAL_API_KEY));
  }

  console.log(`Initialized providers: ${Array.from(providers.keys()).join(", ")}`);
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
