import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/config/database";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl,
  },
});
