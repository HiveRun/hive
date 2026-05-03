import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

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
