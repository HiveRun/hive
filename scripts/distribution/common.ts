import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export const OPENCODE_PACKAGE_NAME = "@opencode-ai/cli";
export const OPENCODE_VERSION = "0.0.0-beta-18866";
export const OPENCODE_VERSION_OUTPUT = `opencode2 v${OPENCODE_VERSION}`;

export const openCodeReleaseBinaryName = (platform = process.platform) =>
  platform === "win32" ? "opencode2.exe" : "opencode2";

export const openCodeNativePackageName = (
  platform = process.platform,
  arch = process.arch
) => {
  let platformName: string | null = null;
  if (platform === "win32") {
    platformName = "windows";
  } else if (platform === "darwin" || platform === "linux") {
    platformName = platform;
  }
  if (!(platformName && (arch === "x64" || arch === "arm64"))) {
    throw new Error(
      `Unsupported OpenCode distribution target: ${platform}-${arch}`
    );
  }
  const baseline = arch === "x64" ? "-baseline" : "";
  return `@opencode-ai/cli-${platformName}-${arch}${baseline}`;
};

const decodeOutput = (value: Uint8Array) => new TextDecoder().decode(value);

export const assertOpenCodeBinary = async (binaryPath: string) => {
  if (!existsSync(binaryPath)) {
    throw new Error(`Bundled OpenCode 2 binary missing at ${binaryPath}`);
  }

  try {
    await access(binaryPath, constants.X_OK);
  } catch {
    throw new Error(
      `Bundled OpenCode 2 binary is not executable: ${binaryPath}`
    );
  }

  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: [binaryPath, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Bundled OpenCode 2 binary cannot run on this platform: ${binaryPath} (${reason})`
    );
  }

  const output =
    `${decodeOutput(result.stdout)}\n${decodeOutput(result.stderr)}`.trim();
  if (result.exitCode !== 0) {
    throw new Error(
      `Bundled OpenCode 2 binary cannot run on this platform: ${binaryPath} (exit ${result.exitCode}${output ? `: ${output}` : ""})`
    );
  }
  if (output !== OPENCODE_VERSION_OUTPUT) {
    throw new Error(
      `Bundled OpenCode 2 version mismatch: expected ${JSON.stringify(OPENCODE_VERSION_OUTPUT)}, received ${JSON.stringify(output)}`
    );
  }
};

export const resolveSupportedPlatform = (usage: string) => {
  const raw = process.platform;
  if (raw === "linux" || raw === "darwin") {
    return raw;
  }
  throw new Error(`Unsupported platform for ${usage}: ${raw}`);
};

export const resolveSupportedArch = (usage: string) => {
  const raw = process.arch;
  if (raw === "x64" || raw === "arm64") {
    return raw;
  }
  throw new Error(`Unsupported architecture for ${usage}: ${raw}`);
};

export const releaseArchivePath = (platform: string, arch: string) =>
  join(repoRoot, "dist", "install", `hive-${platform}-${arch}.tar.gz`);

export const run = (
  cmd: string[],
  options?: {
    env?: Record<string, string>;
    failureMessage?: (code: number) => string;
  }
) => {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    if (options?.failureMessage) {
      throw new Error(options.failureMessage(result.exitCode));
    }

    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }
};
