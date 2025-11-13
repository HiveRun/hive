import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteDatabasePath } from "./config/database";
import { schema } from "./schema";

const sqlite = new Database(sqliteDatabasePath);
export const db = drizzle(sqlite, { schema });
