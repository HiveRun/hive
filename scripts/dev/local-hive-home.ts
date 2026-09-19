import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const DEV_WORKSPACE_ID_LENGTH = 12;

export function resolveWorkspaceRoot(currentDir: string) {
  const normalizedRoot = resolveBaseWorkspaceRoot(currentDir);

  if (hasHiveConfig(normalizedRoot)) {
    return normalizedRoot;
  }

  const nestedCandidate = resolve(normalizedRoot, "hive");
  if (hasHiveConfig(nestedCandidate)) {
    return nestedCandidate;
  }

  return normalizedRoot;
}

export function resolveDefaultDevHiveHome(currentDir: string) {
  return join(resolveWorkspaceRoot(currentDir), ".hive", "home");
}

export function resolveDefaultDevCellsRoot(
  currentDir: string,
  stateHome?: string
) {
  const workspaceRoot = resolveWorkspaceRoot(currentDir);
  const defaultStateHome = join(homedir(), ".local", "state");
  const preferredStateHome = stateHome?.trim() || defaultStateHome;
  const workspaceId = createHash("sha256")
    .update(workspaceRoot)
    .digest("hex")
    .slice(0, DEV_WORKSPACE_ID_LENGTH);
  const buildCellsRoot = (root: string) =>
    join(resolve(root), "hive", "dev-cells", workspaceId);
  const preferredCellsRoot = buildCellsRoot(preferredStateHome);
  if (!isWithinWorkspace(workspaceRoot, preferredCellsRoot)) {
    return preferredCellsRoot;
  }

  const fallbackCellsRoot = buildCellsRoot(
    join(dirname(workspaceRoot), ".hive-dev-state")
  );
  if (isWithinWorkspace(workspaceRoot, fallbackCellsRoot)) {
    throw new Error(
      "Unable to resolve a development cells root outside the workspace"
    );
  }
  return fallbackCellsRoot;
}

function isWithinWorkspace(workspaceRoot: string, candidate: string) {
  const normalizedWorkspace = realpathIfPresent(workspaceRoot);
  const normalizedCandidate = realpathIfPresent(candidate);
  const pathFromWorkspace = relative(normalizedWorkspace, normalizedCandidate);

  return (
    pathFromWorkspace === "" ||
    !(pathFromWorkspace.startsWith(`..${sep}`) || isAbsolute(pathFromWorkspace))
  );
}

function realpathIfPresent(path: string) {
  const absolutePath = resolve(path);
  const missingSegments: string[] = [];
  let existingAncestor = absolutePath;

  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      return absolutePath;
    }
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }

  return resolve(realpathSync(existingAncestor), ...missingSegments);
}

function resolveBaseWorkspaceRoot(currentDir: string) {
  const normalizedCurrentDir = resolve(currentDir);
  const appsSegment = `${sep}apps${sep}`;
  const appsIndex = normalizedCurrentDir.lastIndexOf(appsSegment);

  if (appsIndex >= 0) {
    const root = normalizedCurrentDir.slice(0, appsIndex);
    return root || normalizedCurrentDir;
  }

  return normalizedCurrentDir;
}

function hasHiveConfig(directory: string) {
  return existsSync(join(directory, "hive.config.json"));
}
