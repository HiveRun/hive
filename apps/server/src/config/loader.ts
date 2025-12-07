import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

import { findConfigPath, PREFERRED_CONFIG_FILENAME } from "./files";
import type { HiveConfig } from "./schema";
import { hiveConfigSchema } from "./schema";

const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);
const LINE_SPLIT_REGEX = /\r?\n/;

export async function loadConfig(workspaceRoot: string): Promise<HiveConfig> {
  const configPath = findConfigPath(workspaceRoot);

  if (!configPath) {
    throw new Error(
      `Config not found in ${workspaceRoot}. Create ${PREFERRED_CONFIG_FILENAME} (or hive.config.json).`
    );
  }

  const extension = extname(configPath).toLowerCase();
  if (!JSON_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported config format at ${basename(configPath)}. Use ${PREFERRED_CONFIG_FILENAME} or hive.config.json.`
    );
  }

  const config = await loadJsonConfig(configPath);

  return hiveConfigSchema.parse(config);
}

const loadJsonConfig = async (configPath: string): Promise<unknown> => {
  const contents = await readFile(configPath, "utf8");
  const errors: ParseError[] = [];
  const parsed = parse(contents, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const error = errors[0];
    if (error) {
      const position = toLineColumn(contents, error.offset);
      throw new Error(
        `Could not parse ${basename(configPath)} (${printParseErrorCode(error.error)} at ${position.line}:${position.column})`
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid config format in ${basename(configPath)}: expected a JSON object`
    );
  }

  return parsed;
};

const toLineColumn = (text: string, offset: number) => {
  const preceding = text.slice(0, offset).split(LINE_SPLIT_REGEX);
  const line = preceding.length;
  const column = (preceding.pop()?.length ?? 0) + 1;
  return { line, column } as const;
};
