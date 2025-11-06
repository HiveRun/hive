import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { schema } from "../schema";

export const testDb = drizzle({
  client: createClient({
    url: "file::memory:",
  }),
  schema,
});

// Set up test database schema
export async function setupTestDb() {
  // Run migrations on the test database
  await migrate(testDb, { migrationsFolder: "./src/migrations" });
}
