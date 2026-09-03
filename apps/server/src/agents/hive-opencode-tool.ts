/**
 * Hive OpenCode Plugin Source
 *
 * This module provides the source code for the Hive OpenCode plugin written
 * to each cell worktree. The implementation
 * is in ./tools/hive.ts which is type-checked during development. The source
 * string exported here is generated from that file via scripts/dev.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { HIVE_TOOL_SOURCE_EMBEDDED } from "./hive-opencode-tool-source.generated";

/**
 * The source code for the Hive OpenCode plugin.
 * This is written to .opencode/plugins/hive/index.js in each cell worktree.
 */
const HIVE_TOOL_SOURCE = HIVE_TOOL_SOURCE_EMBEDDED;
const PRIVATE_FILE_MODE = 0o600;

function formatHiveServerHostname(hostname: string): string {
  if (hostname === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (hostname === "::") {
    return "[::1]";
  }
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

export function resolveHiveServerUrl(): string {
  if (process.env.HIVE_URL) {
    return process.env.HIVE_URL;
  }

  const port = process.env.PORT ?? "3000";
  const configuredHostname =
    process.env.HOST ?? process.env.HOSTNAME ?? "127.0.0.1";
  const hostname = formatHiveServerHostname(configuredHostname);
  const protocol = process.env.HIVE_PROTOCOL ?? "http";

  return `${protocol}://${hostname}:${port}`;
}

export async function ensureHiveOpencodePlugin(
  worktreePath: string
): Promise<void> {
  const canonicalWorktree = await realpath(worktreePath);
  const opencodeDirectory = join(worktreePath, ".opencode");
  const pluginDirectory = join(opencodeDirectory, "plugins");
  const hivePluginDirectory = join(pluginDirectory, "hive");
  await ensureContainedDirectory(opencodeDirectory, canonicalWorktree);
  await ensureContainedDirectory(pluginDirectory, canonicalWorktree);
  await ensureContainedDirectory(hivePluginDirectory, canonicalWorktree);

  await unlink(join(pluginDirectory, "hive.ts")).catch((error: unknown) => {
    if (!isMissingPathError(error)) {
      throw error;
    }
  });

  const pluginPath = join(hivePluginDirectory, "index.js");
  const existingPlugin = await lstatIfExists(pluginPath);
  if (existingPlugin?.isSymbolicLink()) {
    throw new Error(
      `Refusing to write Hive plugin through symlink: ${pluginPath}`
    );
  }

  await writeManagedFileAtomically(pluginPath, HIVE_TOOL_SOURCE);
}

async function ensureContainedDirectory(
  directory: string,
  canonicalWorktree: string
): Promise<void> {
  await mkdir(directory).catch((error: unknown) => {
    if (!isExistingPathError(error)) {
      throw error;
    }
  });
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Refusing to use unsafe Hive-managed directory: ${directory}`
    );
  }
  const canonicalDirectory = await realpath(directory);
  if (!isWithin(canonicalWorktree, canonicalDirectory)) {
    throw new Error(`Hive plugin directory escapes worktree: ${directory}`);
  }
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

function lstatIfExists(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  });
}

/**
 * Configuration written to .hive/config.json in each cell worktree.
 * The plugin reads this to get the cell ID and Hive server URL.
 */
type HiveToolConfig = {
  cellId: string;
  hiveUrl: string;
};

/**
 * Generate the config.json content for a cell worktree.
 */
function generateHiveToolConfig(config: HiveToolConfig): string {
  return JSON.stringify(config, null, 2);
}

export async function ensureHiveToolConfig(
  worktreePath: string,
  config: HiveToolConfig
): Promise<void> {
  const canonicalWorktree = await realpath(worktreePath);
  const hiveDirectory = join(worktreePath, ".hive");
  await ensureContainedDirectory(hiveDirectory, canonicalWorktree);

  const configPath = join(hiveDirectory, "config.json");
  const existingConfig = await lstatIfExists(configPath);
  if (existingConfig?.isSymbolicLink()) {
    throw new Error(
      `Refusing to write Hive config through symlink: ${configPath}`
    );
  }

  await writeManagedFileAtomically(configPath, generateHiveToolConfig(config));
}

async function writeManagedFileAtomically(
  destination: string,
  content: string
): Promise<void> {
  const temporaryPath = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const openFlags =
    constants.O_WRONLY +
    constants.O_CREAT +
    constants.O_EXCL +
    constants.O_NOFOLLOW;
  try {
    const handle = await open(temporaryPath, openFlags, PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, destination);
  } catch (error) {
    await unlink(temporaryPath).catch(() => null);
    throw error;
  }
}
