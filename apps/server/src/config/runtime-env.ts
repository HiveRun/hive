import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverEnvPath = resolve(moduleDir, "../../.env");

export const binaryDirectory = dirname(process.execPath);

const runtimeExecutable = basename(process.execPath).toLowerCase();
export const isCompiledRuntime = !runtimeExecutable.startsWith("bun");

export const installManagedEnvKeys = new Set([
  "DATABASE_URL",
  "HIVE_MIGRATIONS_DIR",
  "HIVE_WEB_DIST",
  "HIVE_OPENCODE_BIN",
]);

type RuntimeEnvMap = Record<string, string | undefined>;

type ApplyRuntimeEnvFilesOptions = {
  env: RuntimeEnvMap;
  candidateEnvFiles: string[];
  isCompiledRuntime: boolean;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
};

const applyManagedEnvKeys = (args: {
  env: RuntimeEnvMap;
  parsedEnv: Record<string, string>;
  appliedManagedKeys: Set<string>;
}) => {
  for (const [key, value] of Object.entries(args.parsedEnv)) {
    if (!installManagedEnvKeys.has(key) || args.appliedManagedKeys.has(key)) {
      continue;
    }

    args.env[key] = value;
    args.appliedManagedKeys.add(key);
  }
};

const populateMissingEnvKeys = (args: {
  env: RuntimeEnvMap;
  parsedEnv: Record<string, string>;
}) => {
  for (const [key, value] of Object.entries(args.parsedEnv)) {
    if (typeof args.env[key] === "undefined") {
      args.env[key] = value;
    }
  }
};

export const applyRuntimeEnvFiles = ({
  env,
  candidateEnvFiles: envFiles,
  isCompiledRuntime: compiledRuntime,
  exists,
  readFile,
}: ApplyRuntimeEnvFilesOptions) => {
  const appliedManagedKeys = new Set<string>();

  for (const envFile of envFiles) {
    if (!exists(envFile)) {
      continue;
    }

    const parsed = dotenv.parse(readFile(envFile));

    if (compiledRuntime) {
      applyManagedEnvKeys({
        env,
        parsedEnv: parsed,
        appliedManagedKeys,
      });
    }

    populateMissingEnvKeys({ env, parsedEnv: parsed });
  }
};

const candidateEnvFiles = [
  process.env.HIVE_ENV_FILE,
  join(binaryDirectory, "hive.env"),
  join(binaryDirectory, ".env"),
  serverEnvPath,
].filter((file): file is string => Boolean(file));

applyRuntimeEnvFiles({
  env: process.env,
  candidateEnvFiles,
  isCompiledRuntime,
  exists: existsSync,
  readFile: (path) => readFileSync(path, "utf8"),
});
