import type { Context, Next } from "hono";
import { sign, verify } from "hono/jwt";
import type { ApiKeyModelAccess } from "../modules/keys/services";
import { getActiveApiKeyForAuth, validateApiKey } from "../modules/keys/services";

const playgroundTokenPrefix = "mux_playground_";
const playgroundTokenType = "playground_api_key";
const playgroundTokenTtlSeconds = 5 * 60;

function playgroundTokenSecret() {
  return process.env.PLAYGROUND_TOKEN_SECRET ?? process.env.AUTH_SECRET ?? "dev-change-me";
}

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

export async function createPlaygroundApiKeyToken(apiKeyId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      sub: apiKeyId,
      typ: playgroundTokenType,
      iat: now,
      exp: now + playgroundTokenTtlSeconds,
    },
    playgroundTokenSecret(),
    "HS256",
  );

  return `${playgroundTokenPrefix}${token}`;
}

async function validatePlaygroundApiKeyToken(rawToken: string) {
  if (!rawToken.startsWith(playgroundTokenPrefix)) {
    return null;
  }

  try {
    const payload = await verify(
      rawToken.slice(playgroundTokenPrefix.length),
      playgroundTokenSecret(),
      "HS256",
    );

    if (payload.typ !== playgroundTokenType || typeof payload.sub !== "string") {
      return null;
    }

    return getActiveApiKeyForAuth(payload.sub);
  } catch {
    return null;
  }
}

export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "missing or invalid Authorization header" }, 401);
  }

  const key = authHeader.slice(7);
  const apiKey = key.startsWith(playgroundTokenPrefix)
    ? await validatePlaygroundApiKeyToken(key)
    : await validateApiKey(key);

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
