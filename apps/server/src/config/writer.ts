import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { HiveConfig } from "./schema";

export const HIVE_CONFIG_FILENAME = "hive.config.ts";
const SCHEMA_IMPORT_PATH = "apps/server/src/config/schema";

const normalizeImportPath = (workspaceRoot: string) => {
  const relativePath = relative(
    workspaceRoot,
    join(workspaceRoot, SCHEMA_IMPORT_PATH)
  );
  const normalized =
    relativePath.length === 0 ? SCHEMA_IMPORT_PATH : relativePath;
  const withPrefix = normalized.startsWith(".")
    ? normalized
    : `./${normalized}`;
  return withPrefix.replace(/\\/g, "/");
};

export const formatHiveConfigFile = (
  config: HiveConfig,
  workspaceRoot: string
): string => {
  const schemaImportPath = normalizeImportPath(workspaceRoot);
  const serializedConfig = JSON.stringify(config, null, 2);

  return [
    `import { defineHiveConfig } from "${schemaImportPath}";`,
    "",
    `export default defineHiveConfig(${serializedConfig});`,
    "",
  ].join("\n");
};

export const writeHiveConfigFile = async (
  workspaceRoot: string,
  config: HiveConfig
): Promise<string> => {
  const filePath = join(workspaceRoot, HIVE_CONFIG_FILENAME);
  const content = formatHiveConfigFile(config, workspaceRoot);
  await writeFile(filePath, content, "utf8");
  return filePath;
};
