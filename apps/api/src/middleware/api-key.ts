import type { Context, Next } from "hono";
import { validateApiKey } from "../modules/keys/services";

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

  await next();
}
