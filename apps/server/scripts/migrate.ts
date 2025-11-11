import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

dotenv.config({
  path: "./.env",
});

const databaseUrl = process.env.DATABASE_URL ?? "local.db";
const dbPath = resolve(
  databaseUrl.startsWith("file:")
    ? databaseUrl.replace(/^file:/, "")
    : databaseUrl
);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

try {
  await migrate(db, {
    migrationsFolder: "./src/migrations",
  });
  console.log(`[db:migrate] Applied migrations to ${dbPath}`);
} catch (error) {
  console.error("[db:migrate] Migration failed:", error);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
