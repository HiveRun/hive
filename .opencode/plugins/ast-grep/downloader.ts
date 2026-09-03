import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";

const REPO = "ast-grep/ast-grep";

const DEFAULT_VERSION = "0.40.0";
const EXECUTABLE_FILE_MODE = 0o755;

const logInfo = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const getAstGrepVersion = (): string => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@ast-grep/cli/package.json") as { version?: string };
    return pkg.version ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
};

type PlatformInfo = {
  arch: string;
  os: string;
};

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { arch: "aarch64", os: "apple-darwin" },
  "darwin-x64": { arch: "x86_64", os: "apple-darwin" },
  "linux-arm64": { arch: "aarch64", os: "unknown-linux-gnu" },
  "linux-x64": { arch: "x86_64", os: "unknown-linux-gnu" },
  "win32-x64": { arch: "x86_64", os: "pc-windows-msvc" },
  "win32-arm64": { arch: "aarch64", os: "pc-windows-msvc" },
  "win32-ia32": { arch: "i686", os: "pc-windows-msvc" },
};

export const getCacheDir = (): string => {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? process.env.APPDATA;
    const base = localAppData ?? join(homedir(), "AppData", "Local");
    return join(base, "oh-my-opencode", "bin");
  }

  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache ?? join(homedir(), ".cache");
  return join(base, "oh-my-opencode", "bin");
};

export const getBinaryName = (): string =>
  process.platform === "win32" ? "sg.exe" : "sg";

export const getCachedBinaryPath = (): string | null => {
  const binaryPath = join(getCacheDir(), getBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
};

const extractZip = async (
  archivePath: string,
  destDir: string
): Promise<void> => {
  const proc =
    process.platform === "win32"
      ? spawn([
          "powershell",
          "-command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
        ])
      : spawn(["unzip", "-o", archivePath, "-d", destDir]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    const toolHint =
      process.platform === "win32"
        ? "Ensure PowerShell is available on your system."
        : "Please install 'unzip' (e.g., apt install unzip, brew install unzip).";
    throw new Error(
      `zip extraction failed (exit ${exitCode}): ${stderr}\n\n${toolHint}`
    );
  }
};

export const downloadAstGrep = async (
  version: string = DEFAULT_VERSION
): Promise<string | null> => {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformInfo = PLATFORM_MAP[platformKey];

  if (!platformInfo) {
    logError(
      `[oh-my-opencode] Unsupported platform for ast-grep: ${platformKey}`
    );
    return null;
  }

  const cacheDir = getCacheDir();
  const binaryName = getBinaryName();
  const binaryPath = join(cacheDir, binaryName);

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const { arch, os } = platformInfo;
  const assetName = `app-${arch}-${os}.zip`;
  const downloadUrl = `https://github.com/${REPO}/releases/download/${version}/${assetName}`;

  logInfo("[oh-my-opencode] Downloading ast-grep binary...");

  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    const response = await fetch(downloadUrl, { redirect: "follow" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const archivePath = join(cacheDir, assetName);
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(archivePath, Buffer.from(arrayBuffer));

    await extractZip(archivePath, cacheDir);

    if (existsSync(archivePath)) {
      unlinkSync(archivePath);
    }

    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, EXECUTABLE_FILE_MODE);
    }

    logInfo("[oh-my-opencode] ast-grep binary ready.");

    return binaryPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`[oh-my-opencode] Failed to download ast-grep: ${message}`);
    return null;
  }
};

export const ensureAstGrepBinary = async (): Promise<string | null> => {
  const cachedPath = getCachedBinaryPath();
  if (cachedPath) {
    return cachedPath;
  }

  const version = getAstGrepVersion();
  return await downloadAstGrep(version);
};
