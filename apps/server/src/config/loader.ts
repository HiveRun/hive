import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { findConfigPath, PREFERRED_CONFIG_FILENAME } from "./files";
import type { HiveConfig } from "./schema";
import { hiveConfigSchema } from "./schema";

const JSON_EXTENSIONS = new Set([".json"]);

export async function loadConfig(workspaceRoot: string): Promise<HiveConfig> {
  const configPath = findConfigPath(workspaceRoot);

  if (!configPath) {
    throw new Error(
      `Config not found in ${workspaceRoot}. Create ${PREFERRED_CONFIG_FILENAME}.`
    );
  }

  const extension = extname(configPath).toLowerCase();
  if (!JSON_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported config format at ${basename(configPath)}. Use ${PREFERRED_CONFIG_FILENAME}.`
    );
  }

  const config = await loadJsonConfig(configPath);

  return hiveConfigSchema.parse(config);
}

const loadJsonConfig = async (configPath: string): Promise<unknown> => {
  const contents = await readFile(configPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Could not parse ${basename(configPath)}: ${(error as Error).message}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid config format in ${basename(configPath)}: expected a JSON object`
    );
  }

  return parsed;
};
