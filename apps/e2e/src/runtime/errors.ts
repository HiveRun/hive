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
