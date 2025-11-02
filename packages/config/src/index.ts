export * from "./schema";

import type { SyntheticConfig } from "./schema";
import { syntheticConfigSchema } from "./schema";

/**
 * Define a type-safe Synthetic workspace configuration.
 *
 * @example
 * ```ts
 * import { defineSyntheticConfig } from "@synthetic/config";
 *
 * export default defineSyntheticConfig({
 *   opencode: {
 *     workspaceId: "workspace_123",
 *     token: process.env.OPENCODE_TOKEN,
 *   },
 *   promptSources: ["docs/prompts/**\/*.md"],
 *   templates: [
 *     {
 *       id: "full-stack-dev",
 *       label: "Full Stack Dev Sandbox",
 *       summary: "Boot a web client, API, and database for general feature work",
 *       type: "implementation",
 *       services: [
 *         {
 *           type: "process",
 *           id: "web",
 *           name: "Web Dev Server",
 *           run: "bun run dev:web",
 *           ports: [{ name: "web", preferred: 3001, env: "WEB_PORT" }],
 *           readyPattern: "Local:\\s+http://",
 *         },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export function defineSyntheticConfig(
  config: SyntheticConfig
): SyntheticConfig {
  return syntheticConfigSchema.parse(config);
}

/**
 * Validate a Synthetic configuration without throwing.
 * Returns the parsed config on success, or an error object on failure.
 */
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
    error: result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", "),
  };
}
