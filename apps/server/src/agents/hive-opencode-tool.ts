/**
 * Hive OpenCode Tool Source
 *
 * This module provides the source code for the Hive OpenCode custom tools
 * that are written to each cell worktree. The actual tool implementation
 * is in ./tools/hive.ts which is type-checked during development.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read the tool source from the separate TypeScript file.
 * This file is type-checked during development but read as text at runtime.
 */
function loadToolSource(): string {
  const toolPath = join(__dirname, "tools", "hive.ts");
  return readFileSync(toolPath, "utf-8");
}

/**
 * The source code for the Hive OpenCode tools.
 * This is written to .opencode/tools/hive.ts in each cell worktree.
 */
export const HIVE_TOOL_SOURCE = loadToolSource();

/**
 * Configuration written to .hive/config.json in each cell worktree.
 * Tools read this to get the cell ID and Hive server URL.
 */
export type HiveToolConfig = {
  cellId: string;
  hiveUrl: string;
};

/**
 * Generate the config.json content for a cell worktree.
 */
export function generateHiveToolConfig(config: HiveToolConfig): string {
  return JSON.stringify(config, null, 2);
}
