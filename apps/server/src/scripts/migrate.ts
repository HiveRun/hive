import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sqliteDatabasePath } from "../config/database";
import { schema } from "../schema";

async function runMigrations() {
  const sqlite = new Database(sqliteDatabasePath);
  const db = drizzle(sqlite, { schema });

  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(scriptsDir, "../migrations");

  await migrate(db, { migrationsFolder });
  console.log("✅ Database migrations complete");
  sqlite.close();
}

runMigrations().catch((error) => {
  console.error("Failed to apply migrations", error);
  process.exit(1);
});
