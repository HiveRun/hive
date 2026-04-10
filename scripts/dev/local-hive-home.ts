import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

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

function resolveBaseWorkspaceRoot(currentDir: string) {
  const normalizedCurrentDir = resolve(currentDir);
  const appsSegment = `${sep}apps${sep}`;

  if (normalizedCurrentDir.includes(appsSegment)) {
    const [root] = normalizedCurrentDir.split(appsSegment);
    return root || normalizedCurrentDir;
  }

  return normalizedCurrentDir;
}

function hasHiveConfig(directory: string) {
  return existsSync(join(directory, "hive.config.json"));
}
