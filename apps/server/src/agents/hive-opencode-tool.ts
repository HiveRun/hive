/**
 * Hive OpenCode Tool Source
 *
 * This module provides the source code for the Hive OpenCode custom tools
 * that are written to each cell worktree. The actual tool implementation
 * is in ./tools/hive.ts which is type-checked during development. The source
 * string exported here is generated from that file via scripts/dev.
 */
import { HIVE_TOOL_SOURCE_EMBEDDED } from "./hive-opencode-tool-source.generated";

/**
 * The source code for the Hive OpenCode tools.
 * This is written to .opencode/tools/hive.ts in each cell worktree.
 */
export const HIVE_TOOL_SOURCE = HIVE_TOOL_SOURCE_EMBEDDED;

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
