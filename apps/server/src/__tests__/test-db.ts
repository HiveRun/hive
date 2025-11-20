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
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  const migrationsFolder = join(packageRoot, "src", "migrations");
  await migrate(testDb, { migrationsFolder });
}
