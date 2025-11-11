import { loadConfig } from "./loader";
import type { SyntheticConfig } from "./schema";

let cachedConfigPromise: Promise<SyntheticConfig> | null = null;

export function resolveWorkspaceRoot(): string {
  const currentDir = process.cwd();
  if (currentDir.includes("/apps/")) {
    const [root] = currentDir.split("/apps/");
    return root || currentDir;
  }
  return currentDir;
}

export function getSyntheticConfig(): Promise<SyntheticConfig> {
  if (!cachedConfigPromise) {
    cachedConfigPromise = loadConfig(resolveWorkspaceRoot());
  }
  return cachedConfigPromise;
}
