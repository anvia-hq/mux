# AGENTS.md

Instructions and repository conventions for AI coding agents working in **Mux**.

## Repository Overview

Mux is a Bun TypeScript monorepo implementing a single-workspace MCP & Code Plugin Gateway with Redis tool caching, Better Auth RBAC (`admin` / `member`), and a React dashboard.

- `apps/api` (`@mux/api`) — Elysia HTTP API, Better Auth integration, control-plane routes (`/v1/*`), and Streamable HTTP MCP gateway (`/mcp/:slug`).
- `apps/platform` (`@mux/platform`) — Vite + React + TanStack Router + TanStack Query + Tailwind v4 frontend dashboard.
- `packages/core` (`@mux/core`) — Shared domain types, canonical JSON hashing, AES-256-GCM `SecretVault`, API key hashing, JSON Schema validation, `manifest.json` validator, and Redis `ToolCache`.
- `packages/db` (`@mux/db`) — PostgreSQL + Drizzle ORM schema (`src/schema/*.ts`) and SQL migrations (`drizzle/`).
- `packages/mcp` (`@mux/mcp`) — SSRF-hardened remote MCP client (Streamable HTTP + SSE) and unified MCP gateway (`direct` & `router` modes).
- `packages/plugins` (`@mux/plugins`) — Isolated Bun subprocess plugin runner, path-safety validation, local directory scanner, and atomic uploaded-bundle storage.
- `packages/ui` (`@mux/ui`) — Base UI (`@base-ui/react`) wrappers styled with semantic Tailwind v4 tokens.
- `plugins/example-utils` — Built-in sample `manifest.json` code plugin.
- `tooling/oxlint` — Custom repository oxlint rules (`zstack/*`).

## Architecture Conventions

### Backend (`apps/api`)

- Organize features as vertical slices under `apps/api/src/modules/<feature>/` with clear roles: `types.ts`, `schema.ts`, `repo.ts`, `service.ts`, `router.ts`.
- Wire dependencies exclusively in the composition root (`apps/api/src/composition.ts`) and inject them into `createApp(deps)` (`apps/api/src/app.ts`) so tests run cleanly without module mocking.
- Enforce authentication/RBAC before request body validation (using `.onTransform` auth guards from `apps/api/src/middleware/auth-guard.ts`).
- Throw typed errors from `apps/api/src/errors.ts` (`AppError` subclasses) rather than returning ad-hoc error shapes.
- Preserve PostgreSQL advisory locking (`pg_advisory_xact_lock`) for first-user admin bootstrap and last-admin demotion protection.

### Frontend (`apps/platform` & `packages/ui`)

- Organize UI features under `apps/platform/src/modules/<feature>/{components,hooks,types.ts}` and keep route files in `apps/platform/src/routes/` thin.
- Use `@mux/ui/*` primitives (`Button`, `Input`, `Textarea`, `Select`, `Switch`, `Field`, `Form`, `Card`, `Badge`) for all interactive controls. Never render raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<label>`, or `<form>` tags inside `apps/platform`.
- Import `@base-ui/react/*` **only** inside `packages/ui/src/`.
- Use semantic Tailwind v4 tokens defined in `apps/platform/src/index.css` (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`, etc.). Avoid hardcoded palette classes (`neutral-*`, `gray-*`, `red-*`, `white`, `black`).
- Use `apiRequest` from `apps/platform/src/lib/api-client.ts` for API calls and surface both query and mutation errors explicitly in the UI.

## Strict Lint & Style Rules (`.oxlintrc.json`)

Every file must pass `oxlint` and `oxfmt` with **0 warnings and 0 errors**:

- **No comments** in TS/TSX source files (`zstack/no-comments`, `no-inline-comments`). Write self-explanatory code instead.
- **No barrel files** (`zstack/no-barrel-file`). Import directly from the defining module.
- **No native form/button primitives** outside `packages/ui/src` (`zstack/no-native-primitives`).
- **No Base UI imports** outside `packages/ui/` (`zstack/no-base-ui-outside-ui`).
- **Padded `if` blocks** (`zstack/padded-if`): leave a blank line before and after every `if` block unless immediately following `{` or immediately preceding `}`.
- **No nested ternaries** (`no-nested-ternary`).
- **No conditional spreads** (`zstack/no-conditional-spread`).
- **No `.filter().map()` chains** (`zstack/no-array-filter-map`) — use a single loop or `flatMap`.
- **No chained type assertions** (`zstack/no-chained-type-assertions` in production code).
- **No module mocking** (`zstack/no-module-mocking` — do not use `mock.module`; inject fakes/stubs through factory dependencies).
- **Use `node:` protocol** for Node built-ins (`unicorn/prefer-node-protocol`) and `import type` for type-only imports (`typescript/consistent-type-imports`).

## Security Invariants (Do Not Weaken)

- **Plugin execution isolation (`packages/plugins`)**: Never pass plugin secrets through the child process's OS environment (`process.env`). Pass declared secrets over stdin into a frozen `ctx.env` object, reject reserved env names (`isReservedSecretEnvName`), enforce symlink/traversal/dotfile path checks, keep stdout/stderr bounded, and enforce hard `SIGKILL` timeouts.
- **SSRF hardening (`packages/mcp/src/upstream-client.ts`)**: Keep URL validation, credential rejection, private/loopback/link-local/IPv6/metadata blocking, and manual redirect re-validation intact.
- **Secret storage (`packages/core/src/crypto.ts`)**: Encrypt upstream headers and plugin secrets at rest with `SecretVault` (AES-256-GCM + AAD). Hash API keys with SHA-256 and constant-time comparison; never persist or log raw keys or secret values.
- **Gateway anti-enumeration (`apps/api/src/modules/gateway`)**: Do not leak whether an `/mcp/:slug` endpoint exists to unauthenticated or unauthorized callers.
- **Redacted audit logs**: Never write decrypted headers, secret values, or raw API keys into `tool_executions`.

## Development & Verification Commands

Start/stop local PostgreSQL + Redis (inside `nix develop`):

```bash
services-up
services-down
```

Apply database schema changes:

```bash
bun --filter @mux/db generate
bun --filter @mux/db migrate
```

Run the full verification suite before committing or finishing a task:

```bash
bun run fmt && bun run lint && bun run typecheck && bun run test && bun run build
```

Note: Do not commit `.changes-verification-receipt.json` or `.env`.
