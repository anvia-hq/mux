import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { e2eDatabaseUrl } from "../../e2e/env";

const composeFile = "docker-compose.dev.yaml";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runQuiet(command: string, args: string[]) {
  return (
    spawnSync(command, args, {
      stdio: "ignore",
    }).status === 0
  );
}

function dockerCompose(args: string[]) {
  run("docker", ["compose", "-f", composeFile, ...args]);
}

function dockerComposeQuiet(args: string[]) {
  return runQuiet("docker", ["compose", "-f", composeFile, ...args]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function e2eDatabaseName() {
  const name = decodeURIComponent(new URL(e2eDatabaseUrl).pathname.replace(/^\//, ""));

  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe E2E database name: ${name}`);
  }

  return name;
}

async function waitForServices() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const postgresReady = dockerComposeQuiet([
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      "monorepo_template",
    ]);
    const redisReady = dockerComposeQuiet(["exec", "-T", "redis", "redis-cli", "ping"]);

    if (postgresReady && redisReady) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error("Timed out waiting for E2E Postgres and Redis containers.");
}

async function main() {
  const databaseName = e2eDatabaseName();

  dockerCompose(["up", "-d", "postgres", "redis"]);
  await waitForServices();

  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE);`,
    "-c",
    `CREATE DATABASE "${databaseName}";`,
  ]);

  run(pnpmCommand, ["--filter", "@repo/api", "exec", "prisma", "generate"], {
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
  });
  run(pnpmCommand, ["--filter", "@repo/api", "exec", "prisma", "db", "push"], {
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
  });
}

await main();
