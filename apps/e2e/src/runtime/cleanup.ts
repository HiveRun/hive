import { collectCleanupFailures } from "./errors";
import type { MockLlmServer } from "./mock-llm-server";
import { type ManagedProcess, stopManagedProcesses } from "./process";
import type { RuntimeContext } from "./runtime-context";
import { stopIsolatedOpencodeService } from "./server";

export async function collectRuntimeCleanupFailures(options: {
  context: RuntimeContext;
  failures: unknown[];
  managedProcesses: ManagedProcess[];
  mockLlmServer?: MockLlmServer;
  stopProcess: (process: ManagedProcess) => Promise<void>;
}): Promise<void> {
  await collectCleanupFailures(
    [
      () => stopManagedProcesses(options.managedProcesses, options.stopProcess),
      () => stopIsolatedOpencodeService(options.context),
      () => options.mockLlmServer?.stop() ?? Promise.resolve(),
    ],
    options.failures
  );
}
