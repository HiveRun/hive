import dotenv from "dotenv";

dotenv.config({
  path: "./.env",
});

const envDatabaseUrl = process.env.DATABASE_URL;

if (!envDatabaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const databaseUrl: string = envDatabaseUrl;
