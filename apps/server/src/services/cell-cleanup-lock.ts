const cellCleanupLocks = new Map<string, Promise<void>>();

export async function runWithCellCleanupLock<T>(
  cellId: string,
  action: () => Promise<T>
): Promise<T> {
  const previous = cellCleanupLocks.get(cellId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  cellCleanupLocks.set(cellId, current);

  await previous;
  try {
    return await action();
  } finally {
    release();
    if (cellCleanupLocks.get(cellId) === current) {
      cellCleanupLocks.delete(cellId);
    }
  }
}
