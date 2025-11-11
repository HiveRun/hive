import { resolve } from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "./.env",
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for drizzle config");
}

const normalizedPath = databaseUrl.startsWith("file:")
  ? databaseUrl.replace(/^file:/, "")
  : databaseUrl;

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: resolve(normalizedPath),
  },
  strict: true,
  verbose: true,
});
