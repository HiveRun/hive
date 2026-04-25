import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverEnvPath = resolve(moduleDir, "../../.env");

const resolvedExecPath =
  realpathSync.native?.(process.execPath) ?? realpathSync(process.execPath);

export const binaryDirectory = dirname(resolvedExecPath);

const runtimeExecutable = basename(resolvedExecPath).toLowerCase();
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

const normalizePath = (value: string) => value.replaceAll("\\", "/");

const stripFilePrefix = (value: string) => {
  if (!value.startsWith("file:")) {
    return value;
  }

  if (value.startsWith("file://")) {
    return fileURLToPath(value);
  }

  const withoutPrefix = value.slice("file:".length);
  const [pathOnly = ""] = withoutPrefix.split("?");
  return pathOnly;
};

const looksLikeManagedDatabaseUrl = (value: string) => {
  const normalized = normalizePath(stripFilePrefix(value));
  return (
    normalized.includes("/.hive/") && normalized.endsWith("/state/hive.db")
  );
};

const looksLikeBundledReleasePath = (value: string, suffix: string) => {
  const normalized = normalizePath(value);
  return normalized.includes("/.hive/releases/") && normalized.endsWith(suffix);
};

const shouldPreferBundledValue = (key: string, currentValue: string) => {
  switch (key) {
    case "DATABASE_URL":
      return looksLikeManagedDatabaseUrl(currentValue);
    case "HIVE_MIGRATIONS_DIR":
      return looksLikeBundledReleasePath(currentValue, "/migrations");
    case "HIVE_WEB_DIST":
      return looksLikeBundledReleasePath(currentValue, "/public");
    default:
      return false;
  }
};

const readParsedEnvFile = (args: {
  path: string;
  readFile: (path: string) => string;
}) => {
  try {
    return dotenv.parse(args.readFile(args.path));
  } catch {
    return;
  }
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

    const currentValue = args.env[key];
    if (
      typeof currentValue === "string" &&
      !shouldPreferBundledValue(key, currentValue)
    ) {
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

    const parsed = readParsedEnvFile({ path: envFile, readFile });
    if (!parsed) {
      continue;
    }

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
