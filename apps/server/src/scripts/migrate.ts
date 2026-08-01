import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sqliteDatabasePath } from "../config/database";
import { repairLegacyMigrationGaps } from "../legacy-migration-repairs";
import { schema } from "../schema";

async function runMigrations() {
  const sqlite = new Database(sqliteDatabasePath);
  const db = drizzle(sqlite, { schema });

  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(scriptsDir, "../migrations");

  const repairedGaps = repairLegacyMigrationGaps(db);
  if (repairedGaps.length > 0) {
    console.log(`Repaired legacy migration gaps: ${repairedGaps.join(", ")}`);
  }

  await migrate(db, { migrationsFolder });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  console.log("✅ Database migrations complete");
  sqlite.close();
}

runMigrations().catch((error) => {
  console.error("Failed to apply migrations", error);
  process.exit(1);
});
