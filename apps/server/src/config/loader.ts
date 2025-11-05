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

/**
 * Load and validate synthetic.config.ts from the workspace root
 */
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
    // Dynamic import the config file
    const configModule = await import(configPath);
    const config = configModule.default || configModule;

    // Validate against schema
    return syntheticConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigError(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate a config object without loading from file
 */
export function validateConfig(config: unknown): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}
