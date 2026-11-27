# Mux

**Mux** is a self-hosted **MCP & Code Plugin Gateway** with two-layer Redis tool caching, Better Auth RBAC (`admin` / `member`), scoped Bearer API keys, and a management dashboard.

Register external remote MCP servers or drop in `manifest.json` TypeScript/JavaScript code plugins, configure per-tool caching policies, bind curated tool sets to `/mcp/:slug` endpoints, and expose them cleanly to any MCP client or AI agent.

## Features

- **External MCP Registry** — Connects to remote Streamable HTTP / SSE JSON-RPC 2.0 MCP servers with SSRF protection (blocking loopback, private/link-local/IPv6 ranges, metadata hosts, and unsafe redirects), AES-256-GCM encrypted upstream headers, and catalog synchronization.
- **`manifest.json` Code Plugins** — Supports both local plugins discovered from `./plugins/` and API-uploaded code bundles. Executes tool handlers in isolated Bun subprocesses with per-invocation protocol nonces, frozen `ctx.env` secret injection over stdin, bounded stdout/stderr streams, and hard `SIGKILL` timeouts.
- **Two-Layer Redis Tool Caching** —
  - **Discovery Cache (`tools/list`)**: Caches endpoint tool catalogs in Redis and invalidates on catalog sync or binding changes.
  - **Execution Result Cache (`tools/call`)**: Per-tool policies (`off`, `ttl`, `stale_while_revalidate`), canonical JSON argument hashing, input schema-hash busting, singleflight deduplication, max payload size guards, and tool/tag invalidation.
- **Unified `/mcp/:slug` Gateway** — Exposes bound tools over Streamable HTTP JSON-RPC 2.0 in either `direct` mode (every bound tool listed directly) or `router` mode (meta-tools for search and execution), protected by scoped Bearer API keys.
- **Single-Workspace RBAC** — Powered by Better Auth + PostgreSQL/Drizzle with atomic first-user `admin` bootstrap, last-admin demotion protection, and `admin` / `member` role controls.
- **Platform Dashboard** — React + TanStack Router & Query + Base UI + Tailwind v4 control plane covering Overview metrics, Sources (MCP + local/uploaded plugins), Tools & Cache Rules, Endpoints & Tool Bindings, API Keys, Live Playground, Execution Logs, and Users.

## Workspace Layout

```text
apps/
  api/                  Elysia HTTP API, Better Auth, MCP gateway (/mcp/:slug)
  platform/             Vite + React + TanStack Router dashboard UI
packages/
  core/                 AES-256-GCM SecretVault, canonical JSON, manifest parser, Redis ToolCache
  db/                   Drizzle ORM schema (10 tables) and SQL migrations
  mcp/                  SSRF-hardened MCP upstream client and direct/router gateway
  plugins/              Isolated Bun subprocess plugin runner, path-safety, local/upload runtime
  ui/                   Shared Base UI primitives styled with semantic Tailwind v4 tokens
plugins/
  example-utils/        Built-in example code plugin (slugify tool)
tooling/
  oxlint/               Custom oxlint rules plugin
```

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh)
- PostgreSQL 17 and Redis

If you use Nix, enter the dev shell and start local Postgres (`:5432`) and Redis (`:6379`):

```bash
nix develop
services-up
```

_(Run `services-down` when finished to stop both services.)_

### 2. Configure Environment

```bash
cp .env.example .env
```

Update `.env` with strong secrets (`32+` characters each for `MUX_MASTER_KEY` and `BETTER_AUTH_SECRET`):

```env
DATABASE_URL=postgres://postgres@localhost:5432/mux
REDIS_URL=redis://localhost:6379
PORT=3000
MUX_MASTER_KEY=replace-with-at-least-32-character-random-secret-key
BETTER_AUTH_SECRET=replace-with-at-least-32-character-better-auth-secret
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
PLUGINS_DIR=./plugins
PLUGINS_DATA_DIR=./.data/plugins
```

### 3. Install & Migrate

```bash
bun install
bun --filter @mux/db migrate
```

### 4. Start Development Servers

```bash
bun run dev
```

- **API & MCP Gateway:** `http://localhost:3000` (health check: `GET /health`)
- **Platform Dashboard:** `http://localhost:5173`

Open `http://localhost:5173` and create your first account—the first registered user is automatically promoted to workspace `admin`.

## Connecting an MCP Client

1. Register an external MCP source or rescan/upload a code plugin in **Sources**.
2. Create an endpoint (e.g., `default`) in **Endpoints** and attach the tools you want to expose.
3. Generate an API key in **API Keys** (scoped to an endpoint or workspace-wide for admins).
4. Point your MCP client at `http://localhost:3000/mcp/<slug>` with:

```http
Authorization: Bearer <your-api-key>
Content-Type: application/json
```

## Writing a Code Plugin

Place a directory under `./plugins/<name>/` (or upload it via **Sources** in the dashboard) containing a `manifest.json` and an entry module. See `plugins/example-utils/manifest.json` for a complete working example:

```json
{
  "name": "example-utils",
  "version": "1.0.0",
  "description": "Built-in example code plugin with deterministic utility tools",
  "entry": "./index.ts",
  "secrets": [],
  "timeoutMs": 5000,
  "tools": [
    {
      "name": "slugify",
      "description": "Convert arbitrary text into a URL-safe lowercase slug",
      "handler": "slugifyText",
      "readOnly": true,
      "idempotent": true,
      "inputSchema": {
        "type": "object",
        "required": ["text"],
        "properties": {
          "text": { "type": "string", "minLength": 1 }
        },
        "additionalProperties": false
      },
      "cache": {
        "mode": "ttl",
        "ttlSeconds": 300,
        "tags": ["example-utils"]
      }
    }
  ]
}
```

Handler functions receive `(args, ctx)` where `ctx.env` is a frozen object populated exclusively with the secrets declared in `manifest.json` and configured on the source.

## Scripts

| Command                         | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| `bun run dev`                   | Run API (`:3000`) and Platform UI (`:5173`) concurrently  |
| `bun run dev:api`               | Run `@mux/api` in watch mode                              |
| `bun run dev:platform`          | Run `@mux/platform` Vite dev server                       |
| `bun run build`                 | Build `@mux/api` bundle and `@mux/platform` static assets |
| `bun run typecheck`             | Type-check all workspace packages                         |
| `bun run test`                  | Run all Bun unit and integration tests across workspaces  |
| `bun run lint`                  | Run `oxlint` across the repository                        |
| `bun run fmt`                   | Format files with `oxfmt`                                 |
| `bun run format:check`          | Check formatting without writing changes                  |
| `bun --filter @mux/db generate` | Generate Drizzle SQL migrations after schema edits        |
| `bun --filter @mux/db migrate`  | Apply pending Drizzle migrations to PostgreSQL            |
