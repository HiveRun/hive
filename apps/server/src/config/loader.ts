import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SyntheticConfig } from "./schema";
import { syntheticConfigSchema } from "./schema";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export async function loadConfig(
  workspaceRoot: string
): Promise<SyntheticConfig> {
  const configPath = join(workspaceRoot, "synthetic.config.ts");

  if (!existsSync(configPath)) {
    throw new ConfigError(
      `synthetic.config.ts not found at ${configPath}. Please create one using defineSyntheticConfig().`
    );
  }

  try {
    const configModule = await import(configPath);
    const config = configModule.default || configModule;
    return syntheticConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigError(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

export function validateConfig(config: unknown): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}
