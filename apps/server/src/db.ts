import path from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { databaseUrl } from "./config/database";
import { schema } from "./schema";

const sqlite = new Database(databaseUrl);
export const db = drizzle({ client: sqlite, schema });

// Run migrations automatically on startup
// This ensures the database schema is up to date for both development and e2e tests
// Use absolute path to migrations folder to ensure it works regardless of cwd
const migrationsFolder = path.join(import.meta.dir, "migrations");
await migrate(db, { migrationsFolder });
