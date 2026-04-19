import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverEnvPath = resolve(moduleDir, "../../.env");

export const binaryDirectory = dirname(process.execPath);

const runtimeExecutable = basename(process.execPath).toLowerCase();
export const isCompiledRuntime = !runtimeExecutable.startsWith("bun");

const installManagedEnvKeys = new Set([
  "DATABASE_URL",
  "HIVE_MIGRATIONS_DIR",
  "HIVE_WEB_DIST",
  "HIVE_OPENCODE_BIN",
]);

const candidateEnvFiles = [
  process.env.HIVE_ENV_FILE,
  join(binaryDirectory, "hive.env"),
  join(binaryDirectory, ".env"),
  serverEnvPath,
].filter((file): file is string => Boolean(file));

const appliedManagedKeys = new Set<string>();

for (const envFile of candidateEnvFiles) {
  if (!existsSync(envFile)) {
    continue;
  }

  const parsed = dotenv.parse(readFileSync(envFile));

  if (isCompiledRuntime) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!installManagedEnvKeys.has(key) || appliedManagedKeys.has(key)) {
        continue;
      }

      process.env[key] = value;
      appliedManagedKeys.add(key);
    }
  }

  dotenv.config({
    path: envFile,
    override: false,
  });
}
