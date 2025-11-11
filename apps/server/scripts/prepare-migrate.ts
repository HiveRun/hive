import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: "./.env",
});

const databaseUrl = process.env.DATABASE_URL ?? "local.db";
const normalizedPath = databaseUrl.startsWith("file:")
  ? databaseUrl.replace(/^file:/, "")
  : databaseUrl;
const resolvedPath = resolve(normalizedPath);

if (!existsSync(resolvedPath)) {
  process.exit(0);
}

const expectedMigrations = await readExpectedMigrationCount();

const db = new Database(resolvedPath);
const hasMigrationsTable = Boolean(
  db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get()
);

if (!hasMigrationsTable) {
  db.close();
  await dropDatabase(resolvedPath, "drizzle metadata table was missing");
}

const appliedMigrationsRow = db
  .query("SELECT COUNT(*) as count FROM __drizzle_migrations")
  .get() as { count?: number } | undefined;
const userTablesRow = db
  .query(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '__drizzle_%'"
  )
  .get() as { count?: number } | undefined;
db.close();

const appliedMigrations = Number(appliedMigrationsRow?.count ?? 0);
const userTables = Number(userTablesRow?.count ?? 0);

if (
  expectedMigrations > 0 &&
  userTables > 0 &&
  appliedMigrations < expectedMigrations
) {
  await dropDatabase(
    resolvedPath,
    `only ${appliedMigrations}/${expectedMigrations} migrations were recorded`
  );
}

async function readExpectedMigrationCount(): Promise<number> {
  try {
    const journalPath = resolve(
      process.cwd(),
      "src/migrations/meta/_journal.json"
    );
    const raw = await Bun.file(journalPath).json();
    if (raw && Array.isArray(raw.entries)) {
      return raw.entries.length;
    }
  } catch (error) {
    console.warn(
      `[db:migrate] Unable to read migration journal: ${error instanceof Error ? error.message : error}`
    );
  }
  return 0;
}

async function dropDatabase(path: string, reason: string) {
  await rm(path, { force: true });
  console.log(
    `[db:migrate] Removed ${path} before running migrations: ${reason}.`
  );
  process.exit(0);
}
