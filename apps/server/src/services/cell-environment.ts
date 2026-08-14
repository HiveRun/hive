import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeServiceEnvironmentName } from "../config/service-graph";
import { resolveHiveHome } from "../workspaces/registry";

const CELL_DIRECTORY_MODE = 0o700;
const PATH_SEPARATOR_PATTERN = /[\\/]/;

type CellEnvironment = {
  HIVE_CELL_ID: string;
  HIVE_CLI_BIN: string;
  HIVE_CELL_RUNTIME_DIR: string;
  HIVE_CELL_ARTIFACTS_DIR: string;
  HIVE_BROWSE_ROOT: string;
  HIVE_HOME: string;
};

type ResolveHiveCliBinOptions = {
  execPath?: string;
  isCompiledRuntime?: boolean;
  sourceEntryPath?: string;
};

const hiveCliSourceEntryPath = fileURLToPath(
  new URL("../../../../packages/cli/src/index.ts", import.meta.url)
);

export function resolveHiveCliBin(
  options: ResolveHiveCliBinOptions = {}
): string {
  const execPath = options.execPath ?? process.execPath;
  const compiled =
    options.isCompiledRuntime ??
    !execPath
      .split(PATH_SEPARATOR_PATTERN)
      .at(-1)
      ?.toLowerCase()
      .startsWith("bun");
  return compiled
    ? execPath
    : (options.sourceEntryPath ?? hiveCliSourceEntryPath);
}

type PersistedCellPort = {
  serviceName: string;
  portName: string;
  port: number;
  primary: boolean;
};

function resolveCellDirectory(root: string, cellId: string): string {
  const normalizedRoot = resolve(root);
  const cellDirectory = resolve(normalizedRoot, cellId);
  if (!cellId || dirname(cellDirectory) !== normalizedRoot) {
    throw new Error(`Invalid cell ID for durable directory: ${cellId}`);
  }
  return cellDirectory;
}

function resolveCellDirectoryRoot(kind: "runtime" | "artifacts"): string {
  return resolve(resolveHiveHome(), kind, "cells");
}

export function resolveCellRuntimeDir(cellId: string): string {
  return resolveCellDirectory(resolveCellDirectoryRoot("runtime"), cellId);
}

export function resolveCellArtifactsDir(cellId: string): string {
  return resolveCellDirectory(resolveCellDirectoryRoot("artifacts"), cellId);
}

export function resolveCellEnvironment(
  cellId: string,
  browseRoot: string
): CellEnvironment {
  return {
    HIVE_CELL_ID: cellId,
    HIVE_CLI_BIN: resolveHiveCliBin(),
    HIVE_CELL_RUNTIME_DIR: resolveCellRuntimeDir(cellId),
    HIVE_CELL_ARTIFACTS_DIR: resolveCellArtifactsDir(cellId),
    HIVE_BROWSE_ROOT: browseRoot,
    HIVE_HOME: resolve(browseRoot, ".hive", "home"),
  };
}

function ensurePrivateDirectory(root: string, path: string): void {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const relativePath = relative(normalizedRoot, normalizedPath);
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`Cell environment path is outside its root: ${path}`);
  }

  mkdirSync(normalizedRoot, { recursive: true });
  let current = normalizedRoot;
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);
    try {
      mkdirSync(current, { mode: CELL_DIRECTORY_MODE });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Cell environment path is not a directory: ${current}`);
    }
  }
  chmodSync(normalizedPath, CELL_DIRECTORY_MODE);
}

export function ensureCellEnvironment(
  cellId: string,
  browseRoot: string
): CellEnvironment {
  const environment = resolveCellEnvironment(cellId, browseRoot);
  const hiveHome = resolveHiveHome();
  ensurePrivateDirectory(browseRoot, environment.HIVE_HOME);
  ensurePrivateDirectory(hiveHome, environment.HIVE_CELL_RUNTIME_DIR);
  ensurePrivateDirectory(hiveHome, environment.HIVE_CELL_ARTIFACTS_DIR);
  return environment;
}

export async function removeCellRuntimeDir(cellId: string): Promise<void> {
  await rm(resolveCellRuntimeDir(cellId), { recursive: true, force: true });
}

export function buildPersistedCellPortEnvironment(
  ports: PersistedCellPort[]
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const port of ports) {
    const serviceKey = sanitizeServiceEnvironmentName(port.serviceName);
    const value = String(port.port);
    const portKey = sanitizeServiceEnvironmentName(port.portName);
    environment[`${serviceKey}_${portKey}_PORT`] = value;
    if (port.primary) {
      environment[`${serviceKey}_PORT`] = value;
    }
  }
  return environment;
}

export function areCellEnvironmentsEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}
