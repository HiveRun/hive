import { Database } from "bun:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from "../schema";

// Use in-memory SQLite database for tests (same as production, but in-memory)
const sqlite = new Database(":memory:");

export const testDb = drizzle(sqlite, { schema });

export async function setupTestDb() {
  sqlite.exec("DROP TABLE IF EXISTS cell_timing_events;");
  sqlite.exec("DROP TABLE IF EXISTS cell_activity_events;");
  sqlite.exec("DROP TABLE IF EXISTS cell_services;");
  sqlite.exec("DROP TABLE IF EXISTS cell_provisioning_state;");
  sqlite.exec("DROP TABLE IF EXISTS cells;");
  sqlite.exec("DROP TABLE IF EXISTS __drizzle_migrations;");

  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  const migrationsFolder = join(packageRoot, "src", "migrations");
  await migrate(testDb, { migrationsFolder });
}
