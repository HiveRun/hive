/**
 * Creates an async iterable from a subscription-based event source.
 *
 * This utility extracts the push-pull queue pattern commonly used for SSE streaming.
 * Events are queued when the consumer isn't ready, and yielded immediately when waiting.
 *
 * @param subscribe - Function that registers a handler and returns an unsubscribe function
 * @param signal - AbortSignal to terminate the iterator
 * @returns An async iterable and cleanup function
 */
export function createAsyncEventIterator<T>(
  subscribe: (handler: (event: T) => void) => () => void,
  signal: AbortSignal
): { iterator: AsyncIterable<T>; cleanup: () => void } {
  const queue: T[] = [];
  let resolver: ((value: T | null) => void) | null = null;
  let finished = false;

  const unsubscribe = subscribe((event) => {
    if (resolver) {
      resolver(event);
      resolver = null;
    } else {
      queue.push(event);
    }
  });

  const cleanup = () => {
    if (finished) {
      return;
    }
    finished = true;
    unsubscribe();
    signal.removeEventListener("abort", cleanup);
    if (resolver) {
      resolver(null);
      resolver = null;
    }
  };

  signal.addEventListener("abort", cleanup, { once: true });

  const iterator = {
    async *[Symbol.asyncIterator]() {
      try {
        while (!finished) {
          if (queue.length) {
            const queued = queue.shift();
            if (queued !== undefined) {
              yield queued;
              continue;
            }
          }

          const next = await new Promise<T | null>((resolve) => {
            resolver = resolve;
          });

          if (next === null) {
            break;
          }

          yield next;
        }
      } finally {
        cleanup();
      }
    },
  } satisfies AsyncIterable<T>;

  return { iterator, cleanup };
}
