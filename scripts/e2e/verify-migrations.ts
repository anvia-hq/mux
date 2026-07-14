import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { e2eDatabaseUrl } from "../../e2e/env";

const composeFile = "docker-compose.dev.yaml";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const databaseNames = [
  "mux_responses_migrations_fresh",
  "mux_responses_migrations_dbpush",
  "mux_responses_migrations_partial",
];

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(" ")}`);
}

function quiet(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function compose(args: string[], options: SpawnSyncOptions = {}) {
  run("docker", ["compose", "-f", composeFile, ...args], options);
}

function databaseUrl(name: string) {
  const url = new URL(e2eDatabaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function databaseCommand(name: string, action: "create" | "drop") {
  const sql =
    action === "create"
      ? `CREATE DATABASE "${name}";`
      : `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`;
  compose([
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
    sql,
  ]);
}

function apiCommand(databaseUrlValue: string, args: string[]) {
  run(pnpmCommand, ["--filter", "@repo/api", "exec", ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrlValue },
  });
}

function apiCommandMustFail(databaseUrlValue: string, args: string[], expectedMessage: string) {
  const result = spawnSync(pnpmCommand, ["--filter", "@repo/api", "exec", ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrlValue },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 || !output.includes(expectedMessage)) {
    throw new Error(
      `Expected command to fail with ${JSON.stringify(expectedMessage)}; received:\n${output}`,
    );
  }
}

function executeSql(name: string, sql: string) {
  compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    name,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      quiet("docker", [
        "compose",
        "-f",
        composeFile,
        "exec",
        "-T",
        "postgres",
        "pg_isready",
        "-U",
        "postgres",
      ])
    ) {
      return;
    }
    await delay(1_000);
  }
  throw new Error("Timed out waiting for E2E Postgres");
}

async function main() {
  compose(["up", "-d", "postgres"]);
  await waitForPostgres();

  try {
    for (const name of databaseNames) {
      databaseCommand(name, "drop");
      databaseCommand(name, "create");
    }

    const freshUrl = databaseUrl(databaseNames[0] ?? "");
    apiCommand(freshUrl, ["tsx", "scripts/migrate-deploy.ts"]);
    apiCommand(freshUrl, ["tsx", "scripts/migrate-deploy.ts"]);

    const dbPushUrl = databaseUrl(databaseNames[1] ?? "");
    apiCommand(dbPushUrl, ["prisma", "db", "push"]);
    apiCommand(dbPushUrl, ["tsx", "scripts/migrate-deploy.ts"]);
    apiCommand(dbPushUrl, ["tsx", "scripts/migrate-deploy.ts"]);

    const partialUrl = databaseUrl(databaseNames[2] ?? "");
    apiCommand(partialUrl, ["prisma", "db", "push"]);
    executeSql(
      databaseNames[2] ?? "",
      'ALTER TABLE "CustomProvider" DROP COLUMN "responsesEndpoint";',
    );
    apiCommandMustFail(
      partialUrl,
      ["tsx", "scripts/migrate-deploy.ts"],
      "Custom-provider Responses migration is only partially present",
    );
  } finally {
    for (const name of databaseNames) databaseCommand(name, "drop");
  }
}

await main();
