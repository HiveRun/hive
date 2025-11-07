import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseUrl } from "./config/database";
import { schema } from "./schema";

const client = createClient({
  url: databaseUrl,
});

export const db = drizzle({ client, schema });
