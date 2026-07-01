import type { Context, Next } from "hono";
import type { ApiKeyModelAccess } from "../modules/keys/services";
import { validateApiKey } from "../modules/keys/services";

export function readApiKeyModelAccess(c: Context): ApiKeyModelAccess {
  const allowAllModels = c.get("apiKeyAllowAllModels" as never) as boolean | undefined;
  const includeFutureModels = c.get("apiKeyIncludeFutureModels" as never) as boolean | undefined;
  const allowedModelIds = c.get("apiKeyAllowedModelIds" as never) as string[] | undefined;
  const normalizedAllowAllModels = allowAllModels ?? true;

  return {
    allowAllModels: normalizedAllowAllModels,
    includeFutureModels: includeFutureModels ?? normalizedAllowAllModels,
    allowedModelIds: allowedModelIds ?? [],
  };
}

export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "missing or invalid Authorization header" }, 401);
  }

  const key = authHeader.slice(7);
  const apiKey = await validateApiKey(key);

  if (!apiKey) {
    return c.json({ error: "invalid or revoked API key" }, 401);
  }

  // Set API key info in context for logging
  c.set("apiKeyId", apiKey.id);
  c.set("apiKeyName", apiKey.name);
  c.set("apiKeySpendLimitUsd", apiKey.spendLimitUsd);
  c.set("apiKeyAllowAllModels", apiKey.allowAllModels);
  c.set("apiKeyIncludeFutureModels", apiKey.includeFutureModels);
  c.set("apiKeyAllowedModelIds", apiKey.allowedModelIds);

  await next();
}
