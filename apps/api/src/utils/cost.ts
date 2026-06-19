// Pricing per 1M tokens (input/output) in USD.
// Centralized here so that adding a new model or adjusting rates is a one-line change.
const PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },

  // Anthropic
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },

  // Google
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-pro": { input: 1.25, output: 5 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },

  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-medium-latest": { input: 2.7, output: 8.1 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },
};

/**
 * Estimate the cost in USD for a given model and token usage.
 *
 * Returns 0 for models without a known price table so that logging can
 * proceed without throwing when a new model is added before pricing is set.
 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  const inputCost = (promptTokens * pricing.input) / 1_000_000;
  const outputCost = (completionTokens * pricing.output) / 1_000_000;
  return inputCost + outputCost;
}
