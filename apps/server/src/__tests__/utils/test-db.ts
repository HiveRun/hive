import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { schema } from "../../db";

// Test database type (using Bun SQLite instead of LibSQL)
type TestDbInstance = ReturnType<typeof drizzle>;

export async function createTestDb(): Promise<TestDbInstance> {
  const tempDir = join(tmpdir(), `synthetic-test-${Date.now()}`);
  const dbPath = join(tempDir, "test.db");

  await mkdir(tempDir, { recursive: true });

  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  (db as any).__cleanup = async () => {
    sqlite.close();
    await rm(tempDir, { recursive: true, force: true });
  };

  return db;
}

export async function cleanupTestDb(db: TestDbInstance): Promise<void> {
  const cleanupFn = (db as any).__cleanup;
  if (cleanupFn && typeof cleanupFn === "function") {
    await cleanupFn();
  }
}
