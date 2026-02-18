import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCellTimingStream } from "./use-cell-timing-stream";

type MockEventSourceInstance = {
  url: string;
  closed: boolean;
  addEventListener: (
    event: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener: (
    event: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  close: () => void;
  emit: (event: string, data?: string) => void;
};

const mockEventSourceInstances: MockEventSourceInstance[] = [];
const INVALIDATION_DEBOUNCE_MS = 350;

function MockEventSource(url: string): MockEventSourceInstance {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const instance: MockEventSourceInstance = {
    url,
    closed: false,
    addEventListener(event, listener) {
      const existing = listeners.get(event) ?? new Set();
      existing.add(listener);
      listeners.set(event, existing);
    },
    removeEventListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    close() {
      instance.closed = true;
    },
    emit(event, data = "{}") {
      const message = new MessageEvent(event, { data });
      const registered = listeners.get(event);
      if (!registered) {
        return;
      }

      for (const listener of registered) {
        if (typeof listener === "function") {
          listener(message);
        } else {
          listener.handleEvent(message);
        }
      }
    },
  };

  mockEventSourceInstances.push(instance);
  return instance;
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useCellTimingStream", () => {
  beforeEach(() => {
    mockEventSourceInstances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource
    );
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("subscribes to timing SSE and invalidates timing queries", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useCellTimingStream("cell-1", { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockEventSourceInstances).toHaveLength(1);
    const stream = mockEventSourceInstances[0];
    expect(stream?.url).toContain("/api/cells/cell-1/timings/stream");
    expect(stream?.url).toContain("workflow=create");

    stream?.emit("timing", '{"cellId":"cell-1","workflow":"create"}');
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS);
    await Promise.resolve();

    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    expect(invalidateSpy.mock.calls[0]?.[0]).toMatchObject({
      predicate: expect.any(Function),
    });
    expect(invalidateSpy.mock.calls[1]?.[0]).toMatchObject({
      queryKey: ["cells", "timings", "global"],
    });
  });

  it("invalidates timing queries on snapshot events", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useCellTimingStream("cell-1", { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    const stream = mockEventSourceInstances[0];
    expect(stream).toBeDefined();

    stream?.emit("snapshot", '{"timestamp":123}');

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("debounces timing-event invalidations", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useCellTimingStream("cell-1", { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    const stream = mockEventSourceInstances[0];
    expect(stream).toBeDefined();

    stream?.emit("timing", '{"step":"one"}');
    stream?.emit("timing", '{"step":"two"}');
    stream?.emit("timing", '{"step":"three"}');

    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS);
    await Promise.resolve();

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe when disabled", () => {
    const queryClient = new QueryClient();

    renderHook(() => useCellTimingStream("cell-1", { enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockEventSourceInstances).toHaveLength(0);
  });

  it("closes the event source on unmount", () => {
    const queryClient = new QueryClient();

    const { unmount } = renderHook(() => useCellTimingStream("cell-1"), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockEventSourceInstances).toHaveLength(1);
    const stream = mockEventSourceInstances[0];
    expect(stream?.closed).toBe(false);

    unmount();

    expect(stream?.closed).toBe(true);
  });
});
