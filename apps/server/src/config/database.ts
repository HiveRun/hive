import { fileURLToPath, URL } from "node:url";
import "./runtime-env";

const envDatabaseUrl = process.env.DATABASE_URL;

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
