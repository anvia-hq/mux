# LLM Gateway Design Spec

## Overview

A self-hosted, centralized LLM API gateway focused on two things: unified API access and request logging. An alternative to LiteLLM that stays small and focused -- no routing logic, no fallbacks, no load balancing.

**Deploy with:** `docker compose up -d`
**Consume via:** `POST http://gateway:8000/v1/chat/completions`

---

## Architecture

```
Internal Services
       │
       │ POST /v1/chat/completions
       │ Authorization: Bearer <api-key>
       ▼
┌──────────────────────────────────┐
│         Gateway API (Hono)       │
│                                  │
│  Auth Middleware                  │
│    ↓                             │
│  Provider Router (from model)    │
│    ↓                             │
│  Provider Adapter (normalize)    │
│    ↓                             │
│  Call Provider (stream)          │
│    ↓                             │
│  Normalize Response (OpenAI fmt) │
│    ↓                             │
│  Stream to Client                │
│                                  │
│  Async: Log metadata to buffer   │
│    ↓ (flush every 1-2s)          │
│  PostgreSQL (bulk insert)        │
└──────────────────────────────────┘
       │
       ├── OpenAI
       ├── Anthropic
       ├── Google (Gemini)
       ├── Mistral
       └── ...
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Gateway API | `apps/api` | Hono server, single entry point |
| Platform | `apps/platform` | Dashboard UI (admin/user) |
| Provider Adapters | `apps/api/src/providers/` | Normalize requests/responses per provider |
| Database | PostgreSQL via Prisma | API keys, users, request logs |
| Cache | Redis | Cache API keys (TTL 5-10min) |

### What we removed from the template

- `apps/admin` -- merged into platform (role-based views)
- Worker service -- not needed, no queue processing
- BullMQ/Redis queues -- Redis is cache-only

---

## Authentication and Authorization

### Two auth layers

**1. Service auth (API keys):**
- Internal services pass `Authorization: Bearer <api-key>`
- Keys have prefix: `mux_live_` for easy identification
- Keys are hashed in DB, cached in Redis
- Cache miss hits PostgreSQL, then caches for 5-10 min

**2. Dashboard auth (users):**
- Email/password login with bcrypt hashing
- JWT tokens for session management
- Role-based access control

### Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Create/revoke API keys, manage users, view all logs, view available models |
| **User** | View available models, view all logs (read-only) |

---

## Data Models

### User

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // bcrypt hashed
  role      Role     @default(USER)
  createdAt DateTime @default(now())
}

enum Role {
  ADMIN
  USER
}
```

### ApiKey

```prisma
model ApiKey {
  id        String   @id @default(cuid())
  name      String   // e.g. "billing-service"
  key       String   @unique // hashed, prefixed "mux_live_"
  createdBy String
  creator   User     @relation(fields: [createdBy], references: [id])
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
}
```

### RequestLog

```prisma
model RequestLog {
  id                String   @id @default(cuid())
  apiKeyId          String

  // Provider info
  provider          String   // "openai", "anthropic", "google", "mistral"
  model             String   // "gpt-4o", "claude-sonnet-4-20250514"
  endpoint          String   // "/v1/chat/completions"

  // Performance
  latencyMs         Int
  providerLatencyMs Int?

  // Usage and Cost
  promptTokens      Int?
  completionTokens  Int?
  totalTokens       Int?
  estimatedCost     Float?

  // Status
  statusCode        Int
  errorMessage      String?

  createdAt         DateTime @default(now())

  @@index([apiKeyId])
  @@index([provider])
  @@index([model])
  @@index([createdAt])
}
```

**Note:** No request/response payloads logged. Metadata only. Debug by correlating timestamp + API key + model in application logs.

---

## API Endpoints

### LLM Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/chat/completions` | API Key | Chat completion (streaming and non-streaming) |
| `GET` | `/v1/models` | API Key | List available models across configured providers |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/login` | None | Email/password login, returns JWT |
| `POST` | `/auth/logout` | JWT | Invalidate session |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api-keys` | Admin JWT | List all API keys |
| `POST` | `/api-keys` | Admin JWT | Create new API key |
| `DELETE` | `/api-keys/:id` | Admin JWT | Revoke API key |
| `GET` | `/users` | Admin JWT | List all users |
| `POST` | `/users` | Admin JWT | Create user |

### Logs and Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/logs` | JWT (Admin/User) | List request logs with filters |
| `GET` | `/logs/stats` | JWT (Admin/User) | Aggregated stats (cost, volume, latency) |
| `GET` | `/health` | None | Health check |

---

## Provider Normalization

### Adapter interface

```typescript
interface ProviderAdapter {
  name: string;
  chatCompletion(request: OpenAIRequest): Promise<OpenAIResponse>;
  chatCompletionStream(request: OpenAIRequest): AsyncIterable<OpenAIChunk>;
  listModels(): Promise<Model[]>;
}
```

### Request flow

1. Client sends OpenAI-compatible request to `/v1/chat/completions`
2. Auth middleware validates API key
3. Router identifies provider from model name
4. Adapter normalizes request to provider format
5. Call provider API (streaming)
6. Adapter normalizes chunks back to OpenAI format
7. Stream chunks to client
8. Async: log metadata (tokens, latency, cost, status)

### Model routing

Model names map to providers:

| Model Pattern | Provider |
|---------------|----------|
| `gpt-*` | OpenAI |
| `claude-*` | Anthropic |
| `gemini-*` | Google |
| `mistral-*` | Mistral |

Only providers with configured API keys appear in `/v1/models`.

### Streaming

- All providers support SSE streaming
- Gateway passes chunks through without buffering
- Token counts parsed from the final chunk (provider-specific)
- Client receives OpenAI-format SSE regardless of provider

---

## Performance Strategy

### API Key caching

- Redis cache with 5-10 min TTL
- Cache key: `apikey:{hash}`
- On cache miss: query PostgreSQL, populate cache
- On key revocation: invalidate cache

### Async logging

- Log entries buffered in memory
- Flush to PostgreSQL every 1-2 seconds or every 100 entries
- Use `prisma.requestLog.createMany()` for bulk inserts
- On process crash: buffered logs are lost (acceptable for internal use)

### Provider calls

- HTTP connection pooling (undici with keep-alive)
- Default timeout: 30s (configurable per provider)
- Streaming: no buffering, pass chunks through

---

## Deployment

### Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mux_gateway
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: ["redis-server", "--appendonly", "yes"]

  gateway:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/mux_gateway
      REDIS_URL: redis://redis:6379
      AUTH_SECRET: change-me-in-production
      OPENAI_API_KEY: sk-...
      ANTHROPIC_API_KEY: sk-ant-...
      GOOGLE_API_KEY: ...
      MISTRAL_API_KEY: ...
    depends_on:
      - postgres
      - redis
    command: sh -c "pnpm db:push && pnpm start"

  platform:
    build: .
    ports:
      - "3000:3000"
    environment:
      VITE_API_URL: http://localhost:8000
    depends_on:
      - gateway
    command: pnpm --filter @repo/platform dev

volumes:
  postgres_data:
  redis_data:
```

### Quick start

1. Clone repo
2. Copy `.env.example` to `.env`
3. Add provider API keys to `.env`
4. `docker compose up -d`
5. Gateway available at `http://localhost:8000`
6. Dashboard at `http://localhost:3000`

---

## Project Structure

```
apps/
  api/
    src/
      index.ts                    # Hono app entry
      middleware/
        auth.ts                   # JWT auth middleware
        api-key.ts                # API key auth middleware
        logger.ts                 # Async log buffer + flush
      modules/
        auth/
          router.ts               # Login/logout routes
        keys/
          router.ts               # API key CRUD (admin)
        users/
          router.ts               # User CRUD (admin)
        logs/
          router.ts               # Log viewing + stats
        models/
          router.ts               # /v1/models endpoint
      providers/
        types.ts                  # ProviderAdapter interface
        openai.ts                 # OpenAI adapter
        anthropic.ts              # Anthropic adapter
        google.ts                 # Google/Gemini adapter
        mistral.ts                # Mistral adapter
        registry.ts               # Map models to providers
      utils/
        cost.ts                   # Token cost calculation
        cache.ts                  # Redis cache helpers
    prisma/
      schema.prisma               # Database schema
  platform/
    src/
      ...                         # Dashboard UI
packages/
  ui/                             # Shared UI components
  worker/                         # (remove or repurpose)
```

---

## Out of Scope (Explicitly)

- Request routing / load balancing
- Fallback providers
- Rate limiting (add later if needed)
- Token budget enforcement
- Prompt caching
- Embeddings proxy (add later if needed)
- Function calling normalization (provider-specific for now)
- Multi-tenant isolation (single-org trust model)

---

## Future Considerations

- **Rate limiting:** Per API key, configurable
- **Embeddings endpoint:** `/v1/embeddings` proxy
- **Webhook notifications:** Alert on cost thresholds
- **Provider health dashboard:** Uptime and error rates per provider
- **API key scoping:** Restrict keys to specific models
