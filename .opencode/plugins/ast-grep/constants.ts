import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MIN_BINARY_SIZE_BYTES = 10_000;
const AST_GREP_VERSION = "0.40.0";
const AST_GREP_PACKAGE = "@ast-grep/cli";
const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;

const isValidBinary = (filePath: string): boolean => {
  try {
    return statSync(filePath).size > MIN_BINARY_SIZE_BYTES;
  } catch {
    return false;
  }
};

const unavailableError = (details: string): Error =>
  new Error(
    `Pinned ${AST_GREP_PACKAGE}@${AST_GREP_VERSION} binary is unavailable (${details}); PATH and network fallbacks are disabled.`
  );

const resolvePackageManifest = (): string => {
  const require = createRequire(import.meta.url);
  return require.resolve(`${AST_GREP_PACKAGE}/package.json`);
};

export const resolveSgCliPath = (
  packageManifestResolver: () => string = resolvePackageManifest
): string => {
  try {
    const cliPkgPath = packageManifestResolver();
    const manifest = JSON.parse(readFileSync(cliPkgPath, "utf8")) as {
      version?: string;
    };
    if (manifest.version !== AST_GREP_VERSION) {
      throw unavailableError(
        `resolved package version ${manifest.version ?? "unknown"}`
      );
    }
    const cliDir = dirname(cliPkgPath);
    const binaryName = process.platform === "win32" ? "sg.exe" : "sg";
    const sgPath = join(cliDir, binaryName);

    if (existsSync(sgPath) && isValidBinary(sgPath)) {
      return sgPath;
    }
    throw unavailableError(`missing package binary at ${sgPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pinned ")) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw unavailableError(message);
  }
};

let resolvedCliPath: string | null = null;

export const getSgCliPath = (): string => {
  if (resolvedCliPath !== null) {
    return resolvedCliPath;
  }

  resolvedCliPath = resolveSgCliPath();
  return resolvedCliPath;
};

export const setSgCliPath = (path: string): void => {
  resolvedCliPath = path;
};

export const resetSgCliPath = (): void => {
  resolvedCliPath = null;
};

export const CLI_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml",
] as const;

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_BYTES = BYTES_PER_MIB;
export const DEFAULT_MAX_MATCHES = 500;
