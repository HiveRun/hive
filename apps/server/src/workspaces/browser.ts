import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { hasConfigFile } from "../config/files";
import { isCellWorkspacePath } from "./registry";

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  hasConfig: boolean;
};

export type WorkspaceBrowseResult = {
  path: string;
  parentPath: string | null;
  directories: WorkspaceDirectoryEntry[];
};

const DEFAULT_BROWSE_ROOT = process.env.HIVE_BROWSE_ROOT || homedir();

function normalizeBrowsePath(path?: string): string {
  if (!path) {
    return resolve(DEFAULT_BROWSE_ROOT);
  }
  return resolve(path);
}

function directoryHasConfig(path: string): boolean {
  return hasConfigFile(path);
}

export async function browseWorkspaceDirectories(
  path?: string,
  filter?: string
): Promise<WorkspaceBrowseResult> {
  const targetPath = normalizeBrowsePath(path);
  const targetStats = await stat(targetPath);
  if (!targetStats.isDirectory()) {
    throw new Error(`Path is not a directory: ${targetPath}`);
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const directories: WorkspaceDirectoryEntry[] = [];
  const normalizedFilter = filter?.trim().toLowerCase();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (
      normalizedFilter &&
      !entry.name.toLowerCase().includes(normalizedFilter)
    ) {
      continue;
    }

    const entryPath = join(targetPath, entry.name);
    if (isCellWorkspacePath(entryPath)) {
      continue;
    }

    const hasConfig = directoryHasConfig(entryPath);
    directories.push({
      name: entry.name,
      path: entryPath,
      hasConfig,
    });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = (() => {
    const parent = dirname(targetPath);
    if (parent === targetPath) {
      return null;
    }
    return parent;
  })();

  return {
    path: targetPath,
    parentPath,
    directories,
  };
}
