import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { databaseUrl } from "./config/database";
import { schema } from "./schema";

// bun:sqlite doesn't understand "file:" URLs, so strip the prefix if present
const sqlite = new Database(databaseUrl.replace("file:", ""));
export const db = drizzle({ client: sqlite, schema });
