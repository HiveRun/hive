type ShutdownDependencies = {
  clearOpencodeConnection: () => Promise<void> | void;
  closeAgentSessions: () => Promise<void> | void;
  prepareAgentSessions: () => Promise<void> | void;
  stopCellServices: () => Promise<void> | void;
  stopCellTerminals: () => Promise<void> | void;
  stopChatTerminals: () => Promise<void> | void;
};

export async function runGracefulShutdown(
  dependencies: ShutdownDependencies
): Promise<void> {
  await dependencies.prepareAgentSessions();

  const failures: unknown[] = [];
  const runStep = async (operation: () => Promise<void> | void) => {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  };

  await runStep(dependencies.closeAgentSessions);
  await runStep(dependencies.stopCellServices);
  await runStep(dependencies.stopChatTerminals);
  await runStep(dependencies.stopCellTerminals);
  await runStep(dependencies.clearOpencodeConnection);

  if (failures.length > 0) {
    throw new AggregateError(failures, "Hive shutdown cleanup failed");
  }
}
