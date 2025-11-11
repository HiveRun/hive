import { resolve } from "node:path";
import dotenv from "dotenv";
import { type Config, defineConfig } from "drizzle-kit";

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

const config = defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  driver: "better-sqlite",
  dbCredentials: {
    url: resolve(normalizedPath),
  },
  strict: true,
  verbose: true,
} as Config);

export default config;
