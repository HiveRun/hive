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

    const events: string[] = [];
    for await (const event of iterator) {
      events.push(event);
    }

    expect(events).toEqual(["event1", "event2"]);
  });

  test("yields queued events before async ones", async () => {
    let handler: ((event: string) => void) | null = null;
    const subscribe = (h: (event: string) => void) => {
      handler = h;
      h("queued1");
      h("queued2");
      return () => {
        handler = null;
      };
    };

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(subscribe, controller.signal);

    setTimeout(() => handler?.("async1"), FIRST_EVENT_DELAY_MS);
    setTimeout(() => controller.abort(), SECOND_EVENT_DELAY_MS);

    const events: string[] = [];
    for await (const event of iterator) {
      events.push(event);
    }

    expect(events).toEqual(["queued1", "queued2", "async1"]);
  });

  test("cleanup unsubscribes on abort", async () => {
    const unsubscribe = vi.fn();
    const subscribe = (_handler: (event: string) => void) => unsubscribe;

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(subscribe, controller.signal);

    controller.abort();

    const events: string[] = [];
    for await (const event of iterator) {
      events.push(event);
    }

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  test("cleanup is idempotent", async () => {
    const unsubscribe = vi.fn();
    const subscribe = (_handler: (event: string) => void) => unsubscribe;

    const controller = new AbortController();
    const { iterator, cleanup } = createAsyncEventIterator(
      subscribe,
      controller.signal
    );

    cleanup();
    cleanup();
    controller.abort();

    const events: string[] = [];
    for await (const event of iterator) {
      events.push(event);
    }

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  test("works with typed events", async () => {
    type TestEvent = { type: "add" | "remove"; id: number };
    let handler: ((event: TestEvent) => void) | null = null;
    const subscribe = (h: (event: TestEvent) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    };

    const controller = new AbortController();
    const { iterator } = createAsyncEventIterator(subscribe, controller.signal);

    const addEventDelayMs = 5;
    const removeEventDelayMs = 10;
    const typedAbortDelayMs = 15;
    setTimeout(() => handler?.({ type: "add", id: 1 }), addEventDelayMs);
    setTimeout(() => handler?.({ type: "remove", id: 1 }), removeEventDelayMs);
    setTimeout(() => controller.abort(), typedAbortDelayMs);

    const events: TestEvent[] = [];
    for await (const event of iterator) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "add", id: 1 },
      { type: "remove", id: 1 },
    ]);
  });
});
