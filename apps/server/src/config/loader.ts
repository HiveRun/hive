import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HiveConfig } from "./schema";
import { hiveConfigSchema } from "./schema";

export async function loadConfig(workspaceRoot: string): Promise<HiveConfig> {
  const configPath = join(workspaceRoot, "hive.config.ts");

  if (!existsSync(configPath)) {
    throw new Error(
      `Config not found at ${configPath}. Create hive.config.ts using defineHiveConfig().`
    );
  }

  const configModule = await import(configPath);
  return hiveConfigSchema.parse(configModule.default);
}
