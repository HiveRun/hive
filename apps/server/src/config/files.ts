import { existsSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILENAMES = [
  "hive.config.jsonc",
  "hive.config.json",
] as const;

export type ConfigFilename = (typeof CONFIG_FILENAMES)[number];

export const PREFERRED_CONFIG_FILENAME = CONFIG_FILENAMES[0];

export const findConfigPath = (directory: string): string | null => {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(directory, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const hasConfigFile = (directory: string): boolean =>
  findConfigPath(directory) !== null;
