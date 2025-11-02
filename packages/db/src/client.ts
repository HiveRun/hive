import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Database client configuration
 */
export type DbConfig = {
  /** Path to SQLite database file */
  path: string;
  /** Enable WAL mode for better concurrency */
  wal?: boolean;
};

/**
 * Create a database client instance
 */
export function createDb(
  config: DbConfig
): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(config.path);

  // Enable WAL mode for better concurrency
  if (config.wal !== false) {
    sqlite.pragma("journal_mode = WAL");
  }

  // Enable foreign keys
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

/**
 * Utility to generate UUIDs (simple implementation for now)
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
