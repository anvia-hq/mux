# LLM Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted LLM API gateway with unified API access and request logging.

**Architecture:** Direct proxy pattern with provider normalization. Single Hono endpoint accepts OpenAI-compatible requests, normalizes to provider-specific formats, streams responses back. Async logging to PostgreSQL. Redis for API key caching.

**Tech Stack:** Hono, Prisma, PostgreSQL, Redis, Zod, TypeScript

---

## File Structure

```
apps/api/
  src/
    index.ts                              # Modify: add new routes
    middleware/
      api-key.ts                          # Create: API key auth middleware
      logger.ts                           # Create: async log buffer
    modules/
      auth/
        router.ts                         # Modify: add admin role check
        services.ts                       # Modify: add requireAdmin helper
      keys/
        router.ts                         # Create: API key CRUD (admin)
        services.ts                       # Create: API key operations
        schema.ts                         # Create: API key validation
      models/
        router.ts                         # Create: /v1/models endpoint
      logs/
        router.ts                         # Create: log viewing + stats
        services.ts                       # Create: log queries
      chat/
        router.ts                         # Create: /v1/chat/completions
        services.ts                       # Create: chat completion logic
    providers/
      types.ts                            # Create: ProviderAdapter interface
      openai.ts                           # Create: OpenAI adapter
      anthropic.ts                        # Create: Anthropic adapter
      google.ts                           # Create: Google/Gemini adapter
      mistral.ts                          # Create: Mistral adapter
      registry.ts                         # Create: model-to-provider mapping
    utils/
      cache.ts                            # Create: Redis cache helpers
      cost.ts                             # Create: token cost calculation
      redis.ts                            # Create: Redis client
  prisma/
    schema.prisma                         # Modify: add ApiKey, RequestLog models
```

---

## Task 1: Database Schema - Add ApiKey and RequestLog Models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/utils/prisma.ts`

- [ ] **Step 1: Add ApiKey model to schema**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  ADMIN
  USER
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String
  role         Role     @default(USER)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  apiKeys      ApiKey[]
}

model ApiKey {
  id        String   @id @default(cuid())
  name      String
  key       String   @unique
  createdBy String
  creator   User     @relation(fields: [createdBy], references: [id])
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  logs      RequestLog[]

  @@index([key])
  @@index([isActive])
}

model RequestLog {
  id                String   @id @default(cuid())
  apiKeyId          String
  apiKey            ApiKey   @relation(fields: [apiKeyId], references: [id])

  provider          String
  model             String
  endpoint          String

  latencyMs         Int
  providerLatencyMs Int?

  promptTokens      Int?
  completionTokens  Int?
  totalTokens       Int?
  estimatedCost     Float?

  statusCode        Int
  errorMessage      String?

  createdAt         DateTime @default(now())

  @@index([apiKeyId])
  @@index([provider])
  @@index([model])
  @@index([createdAt])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `cd /Volumes/indrazm/anvia_hq/mux && pnpm --filter @repo/api db:generate`
Expected: Prisma client generated successfully

- [ ] **Step 3: Push schema to database**

Run: `cd /Volumes/indrazm/anvia_hq/mux && pnpm --filter @repo/api db:push`
Expected: Database schema synced

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat: add ApiKey and RequestLog models"
```

---

## Task 2: Redis Client and Cache Utilities

**Files:**
- Create: `apps/api/src/utils/redis.ts`
- Create: `apps/api/src/utils/cache.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install ioredis dependency**

Run: `cd /Volumes/indrazm/anvia_hq/mux && pnpm --filter @repo/api add ioredis`
Expected: ioredis added to dependencies

- [ ] **Step 2: Create Redis client**

```typescript
// apps/api/src/utils/redis.ts
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});

redis.on("connect", () => {
  console.log("Redis connected");
});
```

- [ ] **Step 3: Create cache helpers**

```typescript
// apps/api/src/utils/cache.ts
import { redis } from "./redis";

const DEFAULT_TTL = 600; // 10 minutes

export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data) as T;
}

export async function cacheSet(key: string, value: unknown, ttl = DEFAULT_TTL): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttl);
}

export async function cacheDelete(key: string): Promise<void> {
  await redis.del(key);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/utils/redis.ts apps/api/src/utils/cache.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add Redis client and cache utilities"
```

---

## Task 3: API Key Auth Middleware

**Files:**
- Create: `apps/api/src/middleware/api-key.ts`
- Create: `apps/api/src/modules/keys/services.ts`

- [ ] **Step 1: Create API key services**

```typescript
// apps/api/src/modules/keys/services.ts
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../utils/prisma";
import { cacheDelete, cacheGet, cacheSet } from "../../utils/cache";

const API_KEY_PREFIX = "mux_live_";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function generateApiKey(): Promise<{ raw: string; hashed: string }> {
  const raw = API_KEY_PREFIX + randomBytes(32).toString("hex");
  const hashed = hashKey(raw);
  return { raw, hashed };
}

export async function createApiKey(name: string, userId: string): Promise<{ id: string; key: string }> {
  const { raw, hashed } = await generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      key: hashed,
      createdBy: userId,
    },
  });

  return { id: apiKey.id, key: raw };
}

export async function validateApiKey(rawKey: string) {
  const hashed = hashKey(rawKey);
  const cacheKey = `apikey:${hashed}`;

  // Check cache first
  const cached = await cacheGet<{ id: string; name: string; isActive: boolean }>(cacheKey);
  if (cached) {
    return cached.isActive ? cached : null;
  }

  // Cache miss - query database
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: hashed },
    select: { id: true, name: true, isActive: true },
  });

  if (!apiKey) {
    return null;
  }

  // Cache the result
  await cacheSet(cacheKey, apiKey);

  return apiKey.isActive ? apiKey : null;
}

export async function revokeApiKey(id: string) {
  const apiKey = await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });

  // Invalidate cache
  await cacheDelete(`apikey:${apiKey.key}`);

  return apiKey;
}

export async function listApiKeys() {
  return prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      creator: {
        select: { email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 2: Create API key middleware**

```typescript
// apps/api/src/middleware/api-key.ts
import type { Context, Next } from "hono";
import { validateApiKey } from "../modules/keys/services";

export async function apiKeyAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
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

  await next();
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/keys/services.ts apps/api/src/middleware/api-key.ts
git commit -m "feat: add API key auth middleware and services"
```

---

## Task 4: Provider Adapter Interface and OpenAI Adapter

**Files:**
- Create: `apps/api/src/providers/types.ts`
- Create: `apps/api/src/providers/openai.ts`
- Create: `apps/api/src/providers/registry.ts`

- [ ] **Step 1: Create provider types**

```typescript
// apps/api/src/providers/types.ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export interface ProviderAdapter {
  name: string;
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  listModels(): Model[];
}
```

- [ ] **Step 2: Create OpenAI adapter**

```typescript
// apps/api/src/providers/openai.ts
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          yield JSON.parse(data);
        }
      }
    }
  }

  listModels(): Model[] {
    return [
      { id: "gpt-4o", name: "GPT-4o", provider: this.name },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: this.name },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: this.name },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: this.name },
    ];
  }
}
```

- [ ] **Step 3: Create provider registry**

```typescript
// apps/api/src/providers/registry.ts
import type { ProviderAdapter, Model } from "./types";
import { OpenAIAdapter } from "./openai";
// Import other adapters as they're created

const providers: Map<string, ProviderAdapter> = new Map();

export function initProviders() {
  if (process.env.OPENAI_API_KEY) {
    providers.set("openai", new OpenAIAdapter(process.env.OPENAI_API_KEY));
  }

  // Add other providers here as they're implemented:
  // if (process.env.ANTHROPIC_API_KEY) {
  //   providers.set("anthropic", new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  // }

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
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/providers/types.ts apps/api/src/providers/openai.ts apps/api/src/providers/registry.ts
git commit -m "feat: add provider adapter interface and OpenAI adapter"
```

---

## Task 5: Anthropic Adapter

**Files:**
- Create: `apps/api/src/providers/anthropic.ts`
- Modify: `apps/api/src/providers/registry.ts`

- [ ] **Step 1: Create Anthropic adapter**

```typescript
// apps/api/src/providers/anthropic.ts
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const system = messages.find((m) => m.role === "system")?.content;
    const nonSystem = messages.filter((m) => m.role !== "system");
    return { system, messages: nonSystem };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { system, messages } = this.convertMessages(request.messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.max_tokens ?? 4096,
        system,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // Convert Anthropic response to OpenAI format
    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.content[0].text,
          },
          finish_reason: data.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const { system, messages } = this.convertMessages(request.messages);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.max_tokens ?? 4096,
        system,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));

          // Convert Anthropic events to OpenAI format
          if (data.type === "content_block_delta") {
            yield {
              id: data.id,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: data.delta.text },
                  finish_reason: null,
                },
              ],
            };
          } else if (data.type === "message_stop") {
            yield {
              id: data.id,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            };
          }
        }
      }
    }
  }

  listModels(): Model[] {
    return [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: this.name },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: this.name },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: this.name },
    ];
  }
}
```

- [ ] **Step 2: Update provider registry**

```typescript
// apps/api/src/providers/registry.ts
import type { ProviderAdapter, Model } from "./types";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";

const providers: Map<string, ProviderAdapter> = new Map();

export function initProviders() {
  if (process.env.OPENAI_API_KEY) {
    providers.set("openai", new OpenAIAdapter(process.env.OPENAI_API_KEY));
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.set("anthropic", new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  }

  // Add other providers here as they're implemented:
  // if (process.env.GOOGLE_API_KEY) {
  //   providers.set("google", new GoogleAdapter(process.env.GOOGLE_API_KEY));
  // }

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
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/providers/anthropic.ts apps/api/src/providers/registry.ts
git commit -m "feat: add Anthropic provider adapter"
```

---

## Task 6: Google and Mistral Adapters

**Files:**
- Create: `apps/api/src/providers/google.ts`
- Create: `apps/api/src/providers/mistral.ts`
- Modify: `apps/api/src/providers/registry.ts`

- [ ] **Step 1: Create Google/Gemini adapter**

```typescript
// apps/api/src/providers/google.ts
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

export class GoogleAdapter implements ProviderAdapter {
  name = "google";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getApiUrl(model: string, stream: boolean) {
    const endpoint = stream ? "streamGenerateContent" : "generateContent";
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${this.apiKey}`;
  }

  private convertMessages(messages: ChatCompletionRequest["messages"]) {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === "system");

    return {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction.content }] }
        : undefined,
    };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.convertMessages(request.messages);

    const response = await fetch(this.getApiUrl(request.model, false), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const candidate = data.candidates[0];

    return {
      id: data.id ?? `google-${Date.now()}`,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: candidate.content.parts[0].text,
          },
          finish_reason: candidate.finishReason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const body = this.convertMessages(request.messages);

    const response = await fetch(this.getApiUrl(request.model, true), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Google streams JSON arrays
      const jsonMatch = buffer.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const chunks = JSON.parse(jsonMatch[0]);
        buffer = "";

        for (const chunk of chunks) {
          const candidate = chunk.candidates?.[0];
          if (candidate?.content?.parts?.[0]?.text) {
            yield {
              id: chunk.id ?? `google-${Date.now()}`,
              model: request.model,
              choices: [
                {
                  index: 0,
                  delta: { content: candidate.content.parts[0].text },
                  finish_reason: candidate.finishReason ?? null,
                },
              ],
            };
          }
        }
      }
    }
  }

  listModels(): Model[] {
    return [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: this.name },
      { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro", provider: this.name },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: this.name },
    ];
  }
}
```

- [ ] **Step 2: Create Mistral adapter**

```typescript
// apps/api/src/providers/mistral.ts
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderAdapter,
  Model,
} from "./types";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

export class MistralAdapter implements ProviderAdapter {
  name = "mistral";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async *chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          yield JSON.parse(data);
        }
      }
    }
  }

  listModels(): Model[] {
    return [
      { id: "mistral-large-latest", name: "Mistral Large", provider: this.name },
      { id: "mistral-medium-latest", name: "Mistral Medium", provider: this.name },
      { id: "mistral-small-latest", name: "Mistral Small", provider: this.name },
    ];
  }
}
```

- [ ] **Step 3: Update provider registry with all adapters**

```typescript
// apps/api/src/providers/registry.ts
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
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/providers/google.ts apps/api/src/providers/mistral.ts apps/api/src/providers/registry.ts
git commit -m "feat: add Google and Mistral provider adapters"
```

---

## Task 7: Async Logging Middleware

**Files:**
- Create: `apps/api/src/middleware/logger.ts`
- Create: `apps/api/src/utils/cost.ts`

- [ ] **Step 1: Create cost calculation utility**

```typescript
// apps/api/src/utils/cost.ts

// Pricing per 1M tokens (input/output)
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

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
```

- [ ] **Step 2: Create async logging middleware**

```typescript
// apps/api/src/middleware/logger.ts
import { prisma } from "../utils/prisma";
import { estimateCost } from "../utils/cost";

interface LogEntry {
  apiKeyId: string;
  provider: string;
  model: string;
  endpoint: string;
  latencyMs: number;
  providerLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  statusCode: number;
  errorMessage?: string;
}

const logBuffer: LogEntry[] = [];
const FLUSH_INTERVAL = 2000; // 2 seconds
const MAX_BUFFER_SIZE = 100;

let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer() {
  if (flushTimer) return;

  flushTimer = setInterval(async () => {
    await flushLogs();
  }, FLUSH_INTERVAL);

  // Allow Node.js to exit even if timer is running
  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

async function flushLogs() {
  if (logBuffer.length === 0) return;

  const entries = logBuffer.splice(0, logBuffer.length);

  try {
    await prisma.requestLog.createMany({
      data: entries.map((entry) => ({
        ...entry,
        estimatedCost: estimateCost(
          entry.model,
          entry.promptTokens ?? 0,
          entry.completionTokens ?? 0
        ),
      })),
    });
  } catch (error) {
    console.error("Failed to flush logs:", error);
    // Re-add failed entries to buffer (up to a limit)
    if (logBuffer.length < MAX_BUFFER_SIZE * 2) {
      logBuffer.push(...entries);
    }
  }
}

export function logRequest(entry: LogEntry) {
  logBuffer.push(entry);
  startFlushTimer();

  // Force flush if buffer is full
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushLogs().catch(console.error);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await flushLogs();
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middleware/logger.ts apps/api/src/utils/cost.ts
git commit -m "feat: add async logging middleware with cost estimation"
```

---

## Task 8: Chat Completion Endpoint

**Files:**
- Create: `apps/api/src/modules/chat/router.ts`
- Create: `apps/api/src/modules/chat/services.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create chat completion service**

```typescript
// apps/api/src/modules/chat/services.ts
import type { ChatCompletionRequest } from "../../providers/types";
import { getProvider } from "../../providers/registry";
import { logRequest } from "../../middleware/logger";

export async function handleChatCompletion(
  request: ChatCompletionRequest,
  apiKeyId: string
) {
  const provider = getProvider(request.model);

  if (!provider) {
    throw new Error(`No provider found for model: ${request.model}`);
  }

  const startTime = Date.now();

  try {
    if (request.stream) {
      return {
        stream: provider.chatCompletionStream(request),
        provider: provider.name,
        model: request.model,
        startTime,
      };
    }

    const response = await provider.chatCompletion(request);
    const latencyMs = Date.now() - startTime;

    // Log the request
    logRequest({
      apiKeyId,
      provider: provider.name,
      model: request.model,
      endpoint: "/v1/chat/completions",
      latencyMs,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      statusCode: 200,
    });

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log the failed request
    logRequest({
      apiKeyId,
      provider: provider.name,
      model: request.model,
      endpoint: "/v1/chat/completions",
      latencyMs,
      statusCode: 500,
      errorMessage,
    });

    throw error;
  }
}
```

- [ ] **Step 2: Create chat completion router**

```typescript
// apps/api/src/modules/chat/router.ts
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { apiKeyAuth } from "../../middleware/api-key";
import { handleChatCompletion } from "./services";
import { logRequest } from "../../middleware/logger";

export const chatRouter = new Hono();

chatRouter.use("*", apiKeyAuth);

chatRouter.post("/completions", async (c) => {
  const apiKeyId = c.get("apiKeyId");
  const body = await c.req.json();

  try {
    const result = await handleChatCompletion(body, apiKeyId);

    // Handle streaming response
    if (body.stream && result && "stream" in result) {
      const { stream: streamIterable, provider, model, startTime } = result;

      return stream(c, async (streamWriter) => {
        c.header("Content-Type", "text/event-stream");
        c.header("Cache-Control", "no-cache");
        c.header("Connection", "keep-alive");

        let totalTokens = 0;

        try {
          for await (const chunk of streamIterable) {
            await streamWriter.write(`data: ${JSON.stringify(chunk)}\n\n`);

            // Track tokens if available in chunk
            if (chunk.usage) {
              totalTokens = chunk.usage.total_tokens;
            }
          }

          await streamWriter.write("data: [DONE]\n\n");

          // Log completed stream
          const latencyMs = Date.now() - startTime;
          logRequest({
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/chat/completions",
            latencyMs,
            totalTokens,
            statusCode: 200,
          });
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : "Unknown error";

          logRequest({
            apiKeyId,
            provider,
            model,
            endpoint: "/v1/chat/completions",
            latencyMs,
            statusCode: 500,
            errorMessage,
          });

          throw error;
        }
      });
    }

    // Handle non-streaming response
    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.includes("No provider found")) {
      return c.json({ error: errorMessage }, 404);
    }

    return c.json({ error: errorMessage }, 500);
  }
});
```

- [ ] **Step 3: Add chat router to main app**

```typescript
// apps/api/src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./modules/auth/router";
import { usersRouter } from "./modules/users/router";
import { chatRouter } from "./modules/chat/router";
import { initProviders } from "./providers/registry";

// Initialize providers on startup
initProviders();

const clientOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono()
  .use(
    "*",
    cors({
      origin: (origin) => (clientOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  )
  .get("/health", (c) => {
    return c.json({ ok: true, service: "mux-gateway" });
  })
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/v1/chat", chatRouter);

const port = Number(process.env.API_PORT ?? 8000);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Mux Gateway listening on http://localhost:${info.port}`);
  },
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/chat/router.ts apps/api/src/modules/chat/services.ts apps/api/src/index.ts
git commit -m "feat: add chat completion endpoint with streaming"
```

---

## Task 9: Models Endpoint

**Files:**
- Create: `apps/api/src/modules/models/router.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create models router**

```typescript
// apps/api/src/modules/models/router.ts
import { Hono } from "hono";
import { apiKeyAuth } from "../../middleware/api-key";
import { listAllModels } from "../../providers/registry";

export const modelsRouter = new Hono();

modelsRouter.use("*", apiKeyAuth);

modelsRouter.get("/", (c) => {
  const models = listAllModels();

  return c.json({
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model",
      created: Date.now(),
      owned_by: model.provider,
    })),
  });
});
```

- [ ] **Step 2: Add models router to main app**

```typescript
// apps/api/src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./modules/auth/router";
import { usersRouter } from "./modules/users/router";
import { chatRouter } from "./modules/chat/router";
import { modelsRouter } from "./modules/models/router";
import { initProviders } from "./providers/registry";

// Initialize providers on startup
initProviders();

const clientOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono()
  .use(
    "*",
    cors({
      origin: (origin) => (clientOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  )
  .get("/health", (c) => {
    return c.json({ ok: true, service: "mux-gateway" });
  })
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/v1/chat", chatRouter)
  .route("/v1/models", modelsRouter);

const port = Number(process.env.API_PORT ?? 8000);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Mux Gateway listening on http://localhost:${info.port}`);
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/models/router.ts apps/api/src/index.ts
git commit -m "feat: add models listing endpoint"
```

---

## Task 10: API Key Management Endpoints (Admin)

**Files:**
- Create: `apps/api/src/modules/keys/router.ts`
- Create: `apps/api/src/modules/keys/schema.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create API key schema**

```typescript
// apps/api/src/modules/keys/schema.ts
import { z } from "zod";

export const createKeySchema = z.object({
  name: z.string().min(1, "name is required").max(100),
});
```

- [ ] **Step 2: Create API key router**

```typescript
// apps/api/src/modules/keys/router.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getCurrentUser } from "../auth/services";
import { createApiKey, listApiKeys, revokeApiKey } from "./services";
import { createKeySchema } from "./schema";

export const keysRouter = new Hono();

// Admin-only middleware
keysRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);

  if (!user || user.role !== "ADMIN") {
    return c.json({ error: "admin access required" }, 403);
  }

  c.set("userId", user.id);
  await next();
});

keysRouter.get("/", async (c) => {
  const keys = await listApiKeys();
  return c.json({ keys });
});

keysRouter.post("/", zValidator("json", createKeySchema), async (c) => {
  const { name } = c.req.valid("json");
  const userId = c.get("userId");

  const { id, key } = await createApiKey(name, userId);

  return c.json({ id, key }, 201);
});

keysRouter.delete("/:id", async (c) => {
  const { id } = c.req.param();

  try {
    await revokeApiKey(id);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: "API key not found" }, 404);
  }
});
```

- [ ] **Step 3: Add keys router to main app**

```typescript
// apps/api/src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./modules/auth/router";
import { usersRouter } from "./modules/users/router";
import { chatRouter } from "./modules/chat/router";
import { modelsRouter } from "./modules/models/router";
import { keysRouter } from "./modules/keys/router";
import { initProviders } from "./providers/registry";

// Initialize providers on startup
initProviders();

const clientOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono()
  .use(
    "*",
    cors({
      origin: (origin) => (clientOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  )
  .get("/health", (c) => {
    return c.json({ ok: true, service: "mux-gateway" });
  })
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/v1/chat", chatRouter)
  .route("/v1/models", modelsRouter)
  .route("/api-keys", keysRouter);

const port = Number(process.env.API_PORT ?? 8000);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Mux Gateway listening on http://localhost:${info.port}`);
  },
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/keys/router.ts apps/api/src/modules/keys/schema.ts apps/api/src/index.ts
git commit -m "feat: add API key management endpoints (admin only)"
```

---

## Task 11: Logs and Stats Endpoints

**Files:**
- Create: `apps/api/src/modules/logs/router.ts`
- Create: `apps/api/src/modules/logs/services.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create log services**

```typescript
// apps/api/src/modules/logs/services.ts
import { prisma } from "../../utils/prisma";

export async function getLogs(filters: {
  apiKeyId?: string;
  provider?: string;
  model?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;
  if (filters.provider) where.provider = filters.provider;
  if (filters.model) where.model = filters.model;
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.requestLog.findMany({
      where,
      select: {
        id: true,
        provider: true,
        model: true,
        endpoint: true,
        latencyMs: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCost: true,
        statusCode: true,
        errorMessage: true,
        createdAt: true,
        apiKey: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    }),
    prisma.requestLog.count({ where }),
  ]);

  return { logs, total };
}

export async function getStats(filters: {
  startDate?: Date;
  endDate?: Date;
  groupBy?: "provider" | "model" | "apiKey";
}) {
  const where: any = {};

  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = filters.startDate;
    if (filters.endDate) where.createdAt.lte = filters.endDate;
  }

  const [totalRequests, totalTokens, totalCost, byProvider, byModel] = await Promise.all([
    prisma.requestLog.count({ where }),
    prisma.requestLog.aggregate({
      where,
      _sum: { totalTokens: true },
    }),
    prisma.requestLog.aggregate({
      where,
      _sum: { estimatedCost: true },
    }),
    prisma.requestLog.groupBy({
      by: ["provider"],
      where,
      _count: true,
      _sum: { totalTokens: true, estimatedCost: true },
    }),
    prisma.requestLog.groupBy({
      by: ["model"],
      where,
      _count: true,
      _sum: { totalTokens: true, estimatedCost: true },
    }),
  ]);

  return {
    totalRequests,
    totalTokens: totalTokens._sum.totalTokens ?? 0,
    totalCost: totalCost._sum.estimatedCost ?? 0,
    byProvider: byProvider.map((p) => ({
      provider: p.provider,
      requests: p._count,
      tokens: p._sum.totalTokens ?? 0,
      cost: p._sum.estimatedCost ?? 0,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      requests: m._count,
      tokens: m._sum.totalTokens ?? 0,
      cost: m._sum.estimatedCost ?? 0,
    })),
  };
}
```

- [ ] **Step 2: Create logs router**

```typescript
// apps/api/src/modules/logs/router.ts
import { Hono } from "hono";
import { getCurrentUser } from "../auth/services";
import { getLogs, getStats } from "./services";

export const logsRouter = new Hono();

// Auth required (admin or user)
logsRouter.use("*", async (c, next) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", user);
  await next();
});

logsRouter.get("/", async (c) => {
  const { apiKeyId, provider, model, startDate, endDate, limit, offset } = c.req.query();

  const filters: any = {};
  if (apiKeyId) filters.apiKeyId = apiKeyId;
  if (provider) filters.provider = provider;
  if (model) filters.model = model;
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);
  if (limit) filters.limit = parseInt(limit);
  if (offset) filters.offset = parseInt(offset);

  const result = await getLogs(filters);

  return c.json(result);
});

logsRouter.get("/stats", async (c) => {
  const { startDate, endDate, groupBy } = c.req.query();

  const filters: any = {};
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);
  if (groupBy) filters.groupBy = groupBy;

  const stats = await getStats(filters);

  return c.json(stats);
});
```

- [ ] **Step 3: Add logs router to main app**

```typescript
// apps/api/src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./modules/auth/router";
import { usersRouter } from "./modules/users/router";
import { chatRouter } from "./modules/chat/router";
import { modelsRouter } from "./modules/models/router";
import { keysRouter } from "./modules/keys/router";
import { logsRouter } from "./modules/logs/router";
import { initProviders } from "./providers/registry";

// Initialize providers on startup
initProviders();

const clientOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono()
  .use(
    "*",
    cors({
      origin: (origin) => (clientOrigins.includes(origin) ? origin : null),
      credentials: true,
    }),
  )
  .get("/health", (c) => {
    return c.json({ ok: true, service: "mux-gateway" });
  })
  .route("/auth", authRouter)
  .route("/users", usersRouter)
  .route("/v1/chat", chatRouter)
  .route("/v1/models", modelsRouter)
  .route("/api-keys", keysRouter)
  .route("/logs", logsRouter);

const port = Number(process.env.API_PORT ?? 8000);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Mux Gateway listening on http://localhost:${info.port}`);
  },
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/logs/router.ts apps/api/src/modules/logs/services.ts apps/api/src/index.ts
git commit -m "feat: add logs and stats endpoints"
```

---

## Task 12: Update Docker Compose

**Files:**
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.dev.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Update docker-compose.yaml**

```yaml
name: mux-gateway

services:
  postgres:
    image: postgres:16-alpine
    container_name: mux-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mux_gateway
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d mux_gateway"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: mux-redis
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  gateway:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mux-gateway
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/mux_gateway?schema=public
      REDIS_URL: redis://redis:6379
      AUTH_SECRET: ${AUTH_SECRET:-dev-change-me}
      CLIENT_ORIGINS: ${CLIENT_ORIGINS:-http://localhost:3000}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      GOOGLE_API_KEY: ${GOOGLE_API_KEY:-}
      MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: sh -c "pnpm db:push && pnpm start"

  platform:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mux-platform
    restart: unless-stopped
    environment:
      VITE_API_URL: http://localhost:8000
    ports:
      - "3000:3000"
    depends_on:
      gateway:
        condition: service_started
    command: pnpm --filter @repo/platform dev

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 2: Create .env.example**

```bash
# Gateway Configuration
AUTH_SECRET=change-me-to-a-random-string
CLIENT_ORIGINS=http://localhost:3000

# LLM Provider API Keys (only add what you need)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
MISTRAL_API_KEY=...
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yaml .env.example
git commit -m "feat: update Docker Compose for gateway deployment"
```

---

## Task 13: Final Integration and Testing

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add start script**

```json
{
  "scripts": {
    "dev": "node ../../scripts/with-env.mjs tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json --noEmit",
    "start": "node ../../scripts/with-env.mjs tsx src/index.ts",
    "db:generate": "node ../../scripts/with-env.mjs prisma generate",
    "db:migrate": "node ../../scripts/with-env.mjs prisma migrate dev",
    "db:push": "node ../../scripts/with-env.mjs prisma db push",
    "db:studio": "node ../../scripts/with-env.mjs prisma studio",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Volumes/indrazm/anvia_hq/mux && pnpm --filter @repo/api typecheck`
Expected: No type errors

- [ ] **Step 3: Test with curl**

```bash
# Start the gateway
docker compose up -d

# Login as admin (first create admin user)
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# Create API key
curl -X POST http://localhost:8000/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=<token>" \
  -d '{"name":"test-key"}'

# List models
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer mux_live_<key>"

# Chat completion
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mux_live_<key>" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# View logs
curl http://localhost:8000/logs \
  -H "Cookie: auth_token=<token>"
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json
git commit -m "feat: finalize gateway integration"
```

---

## Summary

Total tasks: 13
Estimated time: 2-3 hours

**What we built:**
- Centralized LLM API gateway with OpenAI-compatible interface
- Provider adapters for OpenAI, Anthropic, Google, Mistral
- API key authentication with Redis caching
- Async request logging with cost estimation
- Admin dashboard for managing keys and viewing logs
- Docker Compose deployment

**Next steps (not in this plan):**
- Build platform UI dashboard
- Add rate limiting
- Add embeddings endpoint
- Add webhook notifications
