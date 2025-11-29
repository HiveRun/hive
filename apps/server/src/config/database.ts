import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import dotenv from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverEnvPath = resolve(moduleDir, "../../.env");
const binaryDirectory = dirname(process.execPath);

const candidateEnvFiles = [
  process.env.HIVE_ENV_FILE,
  join(binaryDirectory, "hive.env"),
  join(binaryDirectory, ".env"),
  serverEnvPath,
].filter((file): file is string => Boolean(file));

for (const envFile of candidateEnvFiles) {
  if (!existsSync(envFile)) {
    continue;
  }

  dotenv.config({
    path: envFile,
    override: false,
  });
}

type BunRuntime = { env?: Record<string, string | undefined> };
const bunEnv = (globalThis as { Bun?: BunRuntime }).Bun?.env;
const envDatabaseUrl = bunEnv?.DATABASE_URL ?? process.env.DATABASE_URL;

if (!envDatabaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const SQLITE_MEMORY_URLS = new Set([":memory:", "file::memory:?cache=shared"]);

const stripFilePrefix = (value: string) => {
  if (!value.startsWith("file:")) {
    return value;
  }
  if (value.startsWith("file://")) {
    return fileURLToPath(new URL(value));
  }

  const withoutPrefix = value.slice("file:".length);
  const [pathOnly] = withoutPrefix.split("?");
  return pathOnly;
};

export const databaseUrl = envDatabaseUrl;
export const sqliteDatabasePath = SQLITE_MEMORY_URLS.has(envDatabaseUrl)
  ? ":memory:"
  : stripFilePrefix(envDatabaseUrl);
