import { createPlaywrightArgs } from "./paths";
import { runCommand } from "./process";
import type { RuntimeContext } from "./runtime-context";

export async function runPlaywrightSuite(options: {
  context: RuntimeContext;
  e2eRoot: string;
  extraEnv: NodeJS.ProcessEnv;
  label: string;
  spec: string | undefined;
  streamOutput?: boolean;
}): Promise<void> {
  await runCommand("bunx", createPlaywrightArgs(options.spec), {
    cwd: options.e2eRoot,
    env: {
      ...process.env,
      HIVE_E2E_API_URL: options.context.apiUrl,
      HIVE_E2E_ARTIFACTS_DIR: options.context.artifactsDir,
      HIVE_E2E_WORKSPACE_PATH: options.context.workspaceRoot,
      HIVE_E2E_HIVE_HOME: options.context.hiveHome,
      ...options.extraEnv,
    },
    label: options.label,
    streamOutput: options.streamOutput,
  });
}
