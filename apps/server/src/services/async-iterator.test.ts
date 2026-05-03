import { afterEach, describe, expect, test, vi } from "vitest";
import { createAsyncEventIterator } from "./async-iterator";

const FIRST_EVENT_DELAY_MS = 10;
const SECOND_EVENT_DELAY_MS = 20;
const ABORT_DELAY_MS = 30;

describe("createAsyncEventIterator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("yields events pushed after subscription", async () => {
    const handlers: ((event: string) => void)[] = [];
    const subscribe = (handler: (event: string) => void) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) {
          handlers.splice(idx, 1);
        }
      };
    };

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(subscribe, controller.signal);

    const emitToAll = (value: string) => {
      for (const h of handlers) {
        h(value);
      }
    };

    setTimeout(() => emitToAll("event1"), FIRST_EVENT_DELAY_MS);
    setTimeout(() => emitToAll("event2"), SECOND_EVENT_DELAY_MS);
    setTimeout(() => controller.abort(), ABORT_DELAY_MS);

    await expect(collectEvents(iterator)).resolves.toEqual([
      "event1",
      "event2",
    ]);
  });

  test("yields queued events before async ones", async () => {
    const subscription = createStoredSubscription<string>();
    const subscribe = (h: (event: string) => void) => {
      subscription.handler = h;
      h("queued1");
      h("queued2");
      return subscription.clear;
    };

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(subscribe, controller.signal);

    setTimeout(() => subscription.handler?.("async1"), FIRST_EVENT_DELAY_MS);
    setTimeout(() => controller.abort(), SECOND_EVENT_DELAY_MS);

    await expect(collectEvents(iterator)).resolves.toEqual([
      "queued1",
      "queued2",
      "async1",
    ]);
  });

  test("cleanup unsubscribes on abort", async () => {
    const { controller, iterator, unsubscribe } = createAbortableIterator();

    controller.abort();

    const events = await collectEvents(iterator);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  test("cleanup is idempotent", async () => {
    const { controller, iterator, cleanup, unsubscribe } =
      createAbortableIterator();

    cleanup();
    cleanup();
    controller.abort();

    await collectEvents(iterator);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test("works with typed events", async () => {
    type TestEvent = { type: "add" | "remove"; id: number };
    const subscription = createStoredSubscription<TestEvent>();

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(
      subscription.subscribe,
      controller.signal
    );

    const addEventDelayMs = 5;
    const removeEventDelayMs = 10;
    const typedAbortDelayMs = 15;
    setTimeout(
      () => subscription.handler?.({ type: "add", id: 1 }),
      addEventDelayMs
    );
    setTimeout(
      () => subscription.handler?.({ type: "remove", id: 1 }),
      removeEventDelayMs
    );
    setTimeout(() => controller.abort(), typedAbortDelayMs);

    await expect(collectEvents(iterator)).resolves.toEqual([
      { type: "add", id: 1 },
      { type: "remove", id: 1 },
    ]);
  });
});

function createAbortableIterator() {
  const unsubscribe = vi.fn();
  const subscribe = (_handler: (event: string) => void) => unsubscribe;
  const controller = new AbortController();
  const created = createAsyncEventIterator(subscribe, controller.signal);
  return { controller, unsubscribe, ...created };
}

function createStoredSubscription<T>() {
  const subscription: {
    handler: ((event: T) => void) | null;
    clear: () => void;
    subscribe: (handler: (event: T) => void) => () => void;
  } = {
    handler: null,
    clear: () => {
      subscription.handler = null;
    },
    subscribe: (handler) => {
      subscription.handler = handler;
      return subscription.clear;
    },
  };
  return subscription;
}

async function collectEvents<T>(iterator: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}
