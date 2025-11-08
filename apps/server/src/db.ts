import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { databaseUrl } from "./config/database";
import { schema } from "./schema";

const sqlite = new Database(databaseUrl);
export const db = drizzle({ client: sqlite, schema });
