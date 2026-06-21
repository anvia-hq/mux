# Contributing to Mux

Thanks for your interest in Mux. This guide explains how to set up the project
locally, the conventions we follow, and how to send a change.

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
Please report unacceptable behavior to the maintainers.

## Project layout

```
apps/
  api/         Hono gateway, Prisma schema, provider adapters
  platform/    React + Vite + TanStack Router dashboard
packages/
  ui/          Shared shadcn-based components
  worker/      Redis + BullMQ primitives
scripts/       Repo-level scripts (env loading, superuser creation)
```

Packages are source-only. There is no build step for `packages/*`; the apps
import their `.ts` / `.tsx` files directly.

## Prerequisites

- Node.js (LTS) and pnpm (`packageManager` is pinned in `package.json`)
- Docker and Docker Compose, for Postgres and Redis
- For database changes: the Prisma CLI (run via pnpm scripts)

## Local setup

```sh
pnpm install
cp .env.example .env
docker compose -f docker-compose.dev.yaml up -d
pnpm db:generate
pnpm db:migrate
```

Run the apps you need:

```sh
pnpm --filter @repo/api dev
pnpm --filter @repo/platform dev
```

The API listens on `http://localhost:8000` and the dashboard on
`http://localhost:3000`. Create your first admin with
`pnpm createsuperuser`.

## Development workflow

- **Branches.** Branch from `main`. Use a short, descriptive name, e.g.
  `feat/embeddings-proxy` or `fix/redis-cache-invalidation`.
- **Commits.** Imperative mood, present tense. Conventional Commits are
  encouraged (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- **Small changes.** Prefer focused commits and pull requests. One concern per
  change.
- **Tests.** Add or update tests for any behavior change. Run the full check
  suite locally before pushing.

## Checks

Before opening a pull request, run:

```sh
pnpm typecheck
pnpm check
```

`pnpm check` runs Biome for formatting and lint. `pnpm check:fix` applies safe
fixes. `pnpm format` formats the codebase. CI is expected to run the same set.

## Database changes

- Edit `apps/api/prisma/schema.prisma`.
- Run `pnpm db:migrate` to generate a migration. Commit the migration files
  alongside the schema change.
- Never edit generated Prisma client output by hand.

## Adding a provider adapter

1. Add an adapter under `apps/api/src/providers/` implementing the
   `ProviderAdapter` interface in `apps/api/src/providers/types.ts`.
2. Register it in `apps/api/src/providers/registry.ts` with its model prefix
   mapping.
3. Add a row in `apps/api/prisma/seed.ts` (if present) for any new catalog data,
   or update cost tables in `apps/api/src/utils/cost.ts`.
4. Add a provider icon and metadata in the dashboard.

## Pull requests

- Open a PR against `main`.
- Fill in the description: what changed, why, and how it was tested. Link any
  related issue.
- Keep the PR up to date with `main`. Rebase rather than merge when possible.
- Address review comments in new commits; maintainers may squash on merge.

## Reporting issues

- Use GitHub Issues.
- For security vulnerabilities, do not open a public issue. Contact the
  maintainers privately first.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
