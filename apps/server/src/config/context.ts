import { resolve as resolvePath } from "node:path";
import { loadConfig } from "./loader";
import type { SyntheticConfig } from "./schema";

const configCache = new Map<string, Promise<SyntheticConfig>>();

export function resolveWorkspaceRoot(): string {
  const forcedWorkspaceRoot = process.env.SYNTHETIC_WORKSPACE_ROOT;
  if (forcedWorkspaceRoot) {
    return resolvePath(forcedWorkspaceRoot);
  }

  const currentDir = process.cwd();
  if (currentDir.includes("/apps/")) {
    const [root] = currentDir.split("/apps/");
    return root || currentDir;
  }
  return currentDir;
}

export function getSyntheticConfig(
  workspaceRoot?: string
): Promise<SyntheticConfig> {
  const normalizedRoot = resolvePath(workspaceRoot ?? resolveWorkspaceRoot());
  if (!configCache.has(normalizedRoot)) {
    configCache.set(normalizedRoot, loadConfig(normalizedRoot));
  }
  return configCache.get(normalizedRoot) as Promise<SyntheticConfig>;
}

export function clearSyntheticConfigCache(workspaceRoot?: string): void {
  if (workspaceRoot) {
    configCache.delete(resolvePath(workspaceRoot));
    return;
  }
  configCache.clear();
}
