import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Context, Layer } from "effect";
import { sqliteDatabasePath } from "./config/database";
import { schema } from "./schema";

const sqlite = new Database(sqliteDatabasePath);
export const db = drizzle(sqlite, { schema });

export type DatabaseService = {
  readonly db: typeof db;
};

export const DatabaseService = Context.GenericTag<DatabaseService>(
  "@hive/server/DatabaseService"
);

export const DatabaseLayer = Layer.succeed(DatabaseService, { db });
