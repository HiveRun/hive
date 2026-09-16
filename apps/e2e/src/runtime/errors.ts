export function throwRunAndCleanupErrors(
  runError: unknown,
  cleanupError: unknown,
  aggregateMessage: string
): void {
  if (runError && cleanupError) {
    throw new AggregateError([runError, cleanupError], aggregateMessage);
  }
  if (runError) {
    throw runError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
}

export async function collectCleanupFailures(
  cleanupSteps: Array<() => Promise<unknown>>,
  failures: unknown[]
): Promise<void> {
  for (const cleanup of cleanupSteps) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
}
