import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SyntheticConfig } from "./schema";
import { syntheticConfigSchema } from "./schema";

export async function loadConfig(workspaceRoot: string): Promise<SyntheticConfig> {
	const configPath = join(workspaceRoot, "synthetic.config.ts");

	if (!existsSync(configPath)) {
		throw new Error(
			`Config not found at ${configPath}. Create synthetic.config.ts using defineSyntheticConfig().`,
		);
	}

	const configModule = await import(configPath);
	return syntheticConfigSchema.parse(configModule.default);
}
