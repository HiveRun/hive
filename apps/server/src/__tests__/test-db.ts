import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from "../schema";

// Use in-memory SQLite database for tests (same as production, but in-memory)
const sqlite = new Database(":memory:");

export const testDb = drizzle({ client: sqlite, schema });

// Set up test database schema
export async function setupTestDb() {
  // Run migrations on the test database
  await migrate(testDb, { migrationsFolder: "./src/migrations" });
}
