import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isConstructWorkspacePath } from "./registry";

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

const SYNTHETIC_CONFIG_FILE = "synthetic.config.ts";
const DEFAULT_BROWSE_ROOT = process.env.SYNTHETIC_BROWSE_ROOT || homedir();

function normalizeBrowsePath(path?: string): string {
  if (!path) {
    return resolve(DEFAULT_BROWSE_ROOT);
  }
  return resolve(path);
}

async function directoryHasConfig(path: string): Promise<boolean> {
  try {
    await access(join(path, SYNTHETIC_CONFIG_FILE));
    return true;
  } catch {
    return false;
  }
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
    if (isConstructWorkspacePath(entryPath)) {
      continue;
    }

    const hasConfig = await directoryHasConfig(entryPath);
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
