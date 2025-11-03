import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from "../../db";

// Test database type (using Bun SQLite instead of LibSQL)
type TestDbInstance = ReturnType<typeof drizzle>;

/**
 * Creates a test database with proper schema migration
 */
export async function createTestDb(): Promise<TestDbInstance> {
  const tempDir = join(tmpdir(), `synthetic-test-${Date.now()}`);
  const dbPath = join(tempDir, "test.db");

  // Create temp directory first
  await mkdir(tempDir, { recursive: true });

  // Create SQLite database
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Run migrations to set up schema
  await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

  // Store cleanup function on the db instance
  (db as any).__cleanup = async () => {
    sqlite.close();
    await rm(tempDir, { recursive: true, force: true });
  };

  return db;
}

/**
 * Cleans up a test database
 */
export async function cleanupTestDb(db: TestDbInstance): Promise<void> {
  const cleanupFn = (db as any).__cleanup;
  if (cleanupFn && typeof cleanupFn === "function") {
    await cleanupFn();
  }
}
