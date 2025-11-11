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

const db = new Database(resolvedPath);
const hasMigrationsTable = db
  .query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
  )
  .get();
db.close();

if (hasMigrationsTable) {
  process.exit(0);
}

await rm(resolvedPath);
console.log(
  `[db:migrate] Removed ${resolvedPath} before running migrations because the drizzle metadata table was missing.`
);
