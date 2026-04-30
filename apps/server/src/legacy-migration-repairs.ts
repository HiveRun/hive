import { sql } from "drizzle-orm";

import type { db } from "./db";

const CELL_PROVISIONING_TABLE = "cell_provisioning_state";
const INITIAL_PROMPT_IMAGES_COLUMN = "initial_prompt_images_json";
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
// Migration 0013 shipped with a timestamp older than 0012. Drizzle compares
// only against the latest recorded timestamp, so databases already past this
// point skip that migration unless we repair the schema before normal migrate.
const INITIAL_PROMPT_IMAGES_MIGRATION_TIMESTAMP = 1_776_611_005_583;

const hasTable = (database: typeof db, tableName: string) => {
  const rows = database.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName} LIMIT 1`
  );

  return rows.length > 0;
};

const hasColumn = (
  database: typeof db,
  tableName: string,
  columnName: string
) => {
  const rows = database.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info(${tableName}) WHERE name = ${columnName} LIMIT 1`
  );

  return rows.length > 0;
};

const readLatestMigrationTimestamp = (database: typeof db) => {
  if (!hasTable(database, DRIZZLE_MIGRATIONS_TABLE)) {
    return null;
  }

  const rows = database.all<{ created_at: number | string | null }>(
    sql`SELECT created_at FROM ${sql.identifier(DRIZZLE_MIGRATIONS_TABLE)} ORDER BY created_at DESC LIMIT 1`
  );

  const latestTimestamp = Number(rows[0]?.created_at);
  return Number.isFinite(latestTimestamp) ? latestTimestamp : null;
};

const shouldRepairInitialPromptImagesColumn = (database: typeof db) => {
  const latestMigrationTimestamp = readLatestMigrationTimestamp(database);

  return (
    latestMigrationTimestamp !== null &&
    latestMigrationTimestamp >= INITIAL_PROMPT_IMAGES_MIGRATION_TIMESTAMP
  );
};

export const repairLegacyMigrationGaps = (database: typeof db): string[] => {
  if (!hasTable(database, CELL_PROVISIONING_TABLE)) {
    return [];
  }

  if (
    hasColumn(database, CELL_PROVISIONING_TABLE, INITIAL_PROMPT_IMAGES_COLUMN)
  ) {
    return [];
  }

  if (!shouldRepairInitialPromptImagesColumn(database)) {
    return [];
  }

  database.run(
    sql`ALTER TABLE ${sql.identifier(CELL_PROVISIONING_TABLE)} ADD COLUMN ${sql.identifier(INITIAL_PROMPT_IMAGES_COLUMN)} text`
  );

  return [`${CELL_PROVISIONING_TABLE}.${INITIAL_PROMPT_IMAGES_COLUMN}`];
};
