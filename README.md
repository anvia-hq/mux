# Mux

> One endpoint. Every model. Full visibility.

Mux is a self-hosted LLM gateway that gives your team a single, OpenAI-compatible API for OpenAI, Anthropic, Google, and Mistral, with built-in observability and key management. Point your services at one URL, and Mux handles authentication, model routing, streaming, and request logging.

It's a deliberately small alternative to LiteLLM: no routing rules, no fallbacks, no load balancing. Just a fast proxy, clean logs, and a dashboard that answers "who spent what on which model, when?"

## Why Mux

- **Unified API.** One `POST /v1/chat/completions` endpoint, OpenAI-shaped, works with every provider you connect. Drop-in for tools and SDKs that already speak OpenAI.
- **Provider freedom.** Configure OpenAI, Anthropic, Google, and Mistral. Switch models without changing your code or your client's config.
- **Streaming by default.** Server-sent events, no buffering, identical chunk shape across providers. Token usage parsed and logged automatically.
- **Observability built in.** Every request is captured with provider, model, latency, prompt/completion tokens, estimated cost, and status. No external logging pipeline required.
- **Encrypted at rest.** Provider API keys are stored encrypted (AES-256-GCM). Only the last four characters are ever shown in the UI.
- **Role-based dashboard.** Admins manage keys, users, and providers. Users browse models and inspect logs. Authenticated sessions, scoped views.
- **Self-hosted, single command.** `docker compose up` and you have a gateway, a dashboard, Postgres, and Redis running together behind Caddy.

## What you get

| Surface | What it does |
| --- | --- |
| Gateway API (`apps/api`) | Hono server. OpenAI-compatible chat completions, model listing, auth, async metadata logging. |
| Platform dashboard (`apps/platform`) | React + TanStack Router. Login, model browser, API key admin, request logs, provider management, model enable/disable. |
| Shared UI (`packages/ui`) | shadcn-based component library used by the dashboard. |
| Background worker (`packages/worker`) | Redis + BullMQ primitives for async jobs. |

## Use Mux

Bring your own provider keys, then point your code at the gateway.

```http
POST /v1/chat/completions
Authorization: Bearer mux_live_...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Summarize this RFC in three bullets." }
  ],
  "stream": true
}
```

Swap `gpt-4o` for `claude-sonnet-4-20250514`, `gemini-...`, or `mistral-...`. The response shape stays OpenAI-compatible. Streamed chunks arrive as SSE; non-streamed requests get a regular JSON response.

List every model you can use:

```http
GET /v1/models
Authorization: Bearer mux_live_...
```

Only providers with configured keys are returned, and disabled models are filtered out.

## The dashboard

- **Overview** — request volume, latency, and cost at a glance.
- **Models** — browse the catalog across providers, see enabled and disabled state.
- **Providers** — add and rotate provider API keys. Encrypted, never displayed in full.
- **API keys** — issue keys for your internal services, revoke instantly, watch usage.
- **Logs** — filter by provider, model, status, time range. Inspect latency, token usage, estimated cost, and error messages.
- **Settings** — manage your account and session.
- **Docs** — inline reference for the gateway API.

## Roles

- **Admin** — full access. Manage providers, API keys, users, and inspect everything.
- **User** — browse models, inspect logs, manage their own account.

## API at a glance

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | Chat completion, streaming or non-streaming |
| `GET` | `/v1/models` | List available models |
| `POST` | `/auth/login` | Email/password session login |
| `POST` | `/auth/logout` | End session |
| `GET` | `/api-keys` | List API keys (admin) |
| `POST` | `/api-keys` | Create API key (admin) |
| `DELETE` | `/api-keys/:id` | Revoke API key (admin) |
| `GET` | `/logs` | Request log browser |
| `GET` | `/logs/stats` | Aggregated cost, volume, latency |
| `GET` | `/providers` | Configured providers and status |
| `GET` | `/health` | Health check |

## What Mux deliberately does not do

To stay fast and small, Mux does not include:

- Request routing or load balancing across providers
- Automatic fallbacks when a provider errors
- Rate limiting or token budgets
- Embeddings proxy or function-call normalization
- Multi-tenant isolation

Add these at the edge or in your application layer when you need them.

## Run it

```sh
cp .env.example .env
docker compose up -d
```

The gateway comes up on `http://localhost:8000`, the dashboard on `http://localhost:3000`. Postgres and Redis stay on the internal network. Use `docker-compose.dev.yaml` when you want to reach the database or cache from your host.

For local development outside Docker, see the developer notes in the package READMEs.
