import type { SyntheticConfig } from "./schema";
import { syntheticConfigSchema } from "./schema";

export function defineSyntheticConfig(
  config: SyntheticConfig
): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}

export function validateSyntheticConfig(
  config: unknown
):
  | { success: true; data: SyntheticConfig }
  | { success: false; error: string } {
  const result = syntheticConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues
      .map((e) => `${String(e.path.join("."))}:${e.message}`)
      .join(", "),
  };
}
