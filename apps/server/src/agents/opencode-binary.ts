import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

export const OPENCODE_VERSION = "0.0.0-beta-18866";
const EXPECTED_VERSION_OUTPUT = `opencode2 v${OPENCODE_VERSION}`;
const BINARY_VALIDATION_TIMEOUT_MS = 2000;

const require = createRequire(import.meta.url);
const validatedBinaries = new Set<string>();

function validateOpencodeBinary(binary: string): string {
  if (validatedBinaries.has(binary)) {
    return binary;
  }

  const result = Bun.spawnSync([binary, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: BINARY_VALIDATION_TIMEOUT_MS,
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (result.exitedDueToTimeout) {
    throw new Error(
      `Timed out after ${BINARY_VALIDATION_TIMEOUT_MS}ms validating OpenCode 2 binary ${binary}`
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to validate OpenCode 2 binary ${binary}: ${stderr || `exit code ${result.exitCode}`}`
    );
  }
  if (stdout !== EXPECTED_VERSION_OUTPUT) {
    throw new Error(
      `OpenCode 2 binary version mismatch for ${binary}: expected "${EXPECTED_VERSION_OUTPUT}", received "${stdout || stderr || "no version output"}"`
    );
  }

  validatedBinaries.add(binary);
  return binary;
}

function resolvePackageBinary(): string | undefined {
  try {
    const packagePath = require.resolve("@opencode-ai/cli/package.json");
    const binary = join(dirname(packagePath), "bin", "opencode2.exe");
    return existsSync(binary) ? binary : undefined;
  } catch {
    return;
  }
}

export function resolveOpencodeBinary(): string {
  const configured = process.env.HIVE_OPENCODE_BIN?.trim();
  if (configured) {
    return validateOpencodeBinary(resolve(configured));
  }

  const executable =
    realpathSync.native?.(process.execPath) ?? realpathSync(process.execPath);
  const runtimeName = basename(executable).toLowerCase();
  if (!runtimeName.startsWith("bun")) {
    const bundled = join(
      dirname(executable),
      process.platform === "win32" ? "opencode2.exe" : "opencode2"
    );
    if (existsSync(bundled)) {
      return validateOpencodeBinary(bundled);
    }
  }

  const packageBinary = resolvePackageBinary();
  if (packageBinary) {
    return validateOpencodeBinary(packageBinary);
  }

  throw new Error(
    "OpenCode 2 binary was not found. Reinstall Hive or set HIVE_OPENCODE_BIN to the opencode2 executable."
  );
}
