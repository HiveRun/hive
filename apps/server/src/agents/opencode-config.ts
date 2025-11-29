import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKSPACE_CONFIG_CANDIDATES = [
  "@opencode.json",
  "opencode.json",
] as const;

export type LoadedOpencodeConfig = {
  config: Record<string, unknown>;
  source: "workspace" | "default";
  details?: string;
};

export async function loadOpencodeConfig(
  workspaceRootPath: string
): Promise<LoadedOpencodeConfig> {
  const fileConfig = await readWorkspaceConfig(workspaceRootPath);
  if (fileConfig) {
    return { config: fileConfig, source: "workspace" };
  }

  return { config: {}, source: "default" };
}

async function readWorkspaceConfig(
  workspaceRootPath: string
): Promise<Record<string, unknown> | undefined> {
  for (const filename of WORKSPACE_CONFIG_CANDIDATES) {
    const configPath = join(workspaceRootPath, filename);
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        continue;
      }
      throw new Error(
        `Failed to read OpenCode config from ${configPath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  return;
}
