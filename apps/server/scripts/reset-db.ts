import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: "./.env",
});

const databaseUrl = process.env.DATABASE_URL ?? "local.db";
const dbPath = resolve(
  databaseUrl.startsWith("file:")
    ? databaseUrl.replace(/^file:/, "")
    : databaseUrl
);

if (!existsSync(dbPath)) {
  console.log(`[db:reset] No SQLite file found at ${dbPath}`);
  process.exit(0);
}

await rm(dbPath);
console.log(
  `[db:reset] Removed ${dbPath}. Run "bun run db:migrate" to recreate it.`
);
