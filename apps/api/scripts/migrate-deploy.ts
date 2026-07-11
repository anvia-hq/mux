import { spawnSync } from "node:child_process";
import { Client } from "pg";

const BASELINE_MIGRATIONS = [
  "20260621093928_initdb",
  "20260621120000_add_api_key_spend_limit",
  "20260621130000_add_fallback_groups",
  "20260624120000_add_background_response_jobs",
  "20260624130000_add_reasoning_tokens",
  "20260624140000_add_background_response_pricing",
  "20260629120000_add_api_key_model_filters",
  "20260701120000_add_invitations",
  "20260701130000_add_api_key_future_model_access",
  "20260701140000_add_custom_providers",
  "20260701150000_default_custom_provider_capabilities",
  "20260701160000_invitation_registration_controls",
  "20260701170000_store_revealable_api_keys",
  "20260701180000_add_model_aliases",
  "20260702100000_add_provider_channels",
  "20260702110000_add_redemption_codes",
] as const;

const TIERED_PRICING_MIGRATION = "20260711120000_add_model_pricing_tiers";

const REQUIRED_TABLES = [
  "ApiKey",
  "AppSetting",
  "BackgroundResponseJob",
  "CustomProvider",
  "CustomProviderModel",
  "FallbackGroup",
  "Invitation",
  "ModelAlias",
  "ProviderChannel",
  "RedemptionCode",
  "RequestLog",
  "User",
] as const;

const REQUIRED_COLUMNS = [
  ["ApiKey", "allowedModelIds"],
  ["ApiKey", "includeFutureModels"],
  ["ApiKey", "keyCiphertext"],
  ["ApiKey", "spendLimitUsd"],
  ["BackgroundResponseJob", "inputPricePer1M"],
  ["CustomProviderModel", "structuredOutput"],
  ["RequestLog", "reasoningTokens"],
] as const;

const TIERED_PRICING_COLUMNS = [
  ["BackgroundResponseJob", "pricingTiers"],
  ["CustomProviderModel", "pricingTiers"],
  ["RequestLog", "appliedInputPricePer1M"],
  ["RequestLog", "appliedOutputPricePer1M"],
  ["RequestLog", "appliedPricingTierThreshold"],
  ["RequestLog", "pricingInputTokens"],
] as const;

function runPrisma(args: string[]) {
  const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function pgConnectionString(value: string) {
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url.toString();
}

async function inspectDatabase(databaseUrl: string) {
  const client = new Client({ connectionString: pgConnectionString(databaseUrl) });
  await client.connect();
  try {
    const migrationTable = await client.query<{ migration_table: string | null }>(
      `SELECT to_regclass('public._prisma_migrations')::text AS migration_table`,
    );
    const migrationCount = migrationTable.rows[0]?.migration_table
      ? Number(
          (
            await client.query<{ migration_count: string }>(
              `SELECT COUNT(*)::text AS migration_count FROM "_prisma_migrations"`,
            )
          ).rows[0]?.migration_count ?? 0,
        )
      : 0;
    const schemaColumns = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const columns = new Set(
      schemaColumns.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const tableCount = new Set(
      schemaColumns.rows
        .map((row) => row.table_name)
        .filter((table) => table !== "_prisma_migrations"),
    ).size;
    return {
      migrationCount,
      tableCount,
      columns,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const database = await inspectDatabase(databaseUrl);
  if (database.migrationCount > 0 || database.tableCount === 0) {
    runPrisma(["migrate", "deploy"]);
    return;
  }

  const missingTables = REQUIRED_TABLES.filter(
    (table) => !Array.from(database.columns).some((column) => column.startsWith(`${table}.`)),
  );
  const missingColumns = REQUIRED_COLUMNS.filter(
    ([table, column]) => !database.columns.has(`${table}.${column}`),
  );
  if (missingTables.length > 0 || missingColumns.length > 0) {
    throw new Error(
      [
        "Database has application tables but no Prisma migration history and cannot be safely baselined.",
        missingTables.length ? `Missing tables: ${missingTables.join(", ")}.` : "",
        missingColumns.length
          ? `Missing columns: ${missingColumns.map(([table, column]) => `${table}.${column}`).join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const tieredPricingColumnsPresent = TIERED_PRICING_COLUMNS.filter(([table, column]) =>
    database.columns.has(`${table}.${column}`),
  );
  if (
    tieredPricingColumnsPresent.length > 0 &&
    tieredPricingColumnsPresent.length !== TIERED_PRICING_COLUMNS.length
  ) {
    throw new Error(
      "Tiered-pricing migration is only partially present; manual repair is required.",
    );
  }

  console.log("Existing db-push database detected; recording the migration baseline.");
  for (const migration of BASELINE_MIGRATIONS) {
    runPrisma(["migrate", "resolve", "--applied", migration]);
  }

  if (tieredPricingColumnsPresent.length === TIERED_PRICING_COLUMNS.length) {
    runPrisma(["migrate", "resolve", "--applied", TIERED_PRICING_MIGRATION]);
  }

  runPrisma(["migrate", "deploy"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
