import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellTimingResponse } from "@/queries/cells";
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
const TIMING_QUERY_LIMIT = 300;
const SNAPSHOT_TIMESTAMP = 123;

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

function seedTimingResponse(): CellTimingResponse {
  return {
    steps: [],
    runs: [],
  };
}

describe("useCellTimingStream", () => {
  beforeEach(() => {
    mockEventSourceInstances.length = 0;
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("subscribes to timing SSE and updates matching timing queries from stream events", () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      ["cells", "cell-1", "timings", TIMING_QUERY_LIMIT, "create", null],
      seedTimingResponse()
    );

    renderHook(() => useCellTimingStream("cell-1", { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockEventSourceInstances).toHaveLength(1);
    const stream = mockEventSourceInstances[0];
    expect(stream?.url).toContain("/api/cells/cell-1/timings/stream");
    expect(stream?.url).toContain("workflow=create");

    stream?.emit(
      "timing",
      JSON.stringify({
        id: "timing-1",
        cellId: "cell-1",
        cellName: "Cell 1",
        workspaceId: "workspace-1",
        templateId: "template-1",
        runId: "run-1",
        workflow: "create",
        step: "prepare_workspace",
        status: "ok",
        durationMs: 12,
        attempt: 1,
        error: null,
        metadata: {},
        createdAt: "2026-03-19T19:00:00.000Z",
      })
    );

    expect(
      queryClient.getQueryData<CellTimingResponse>([
        "cells",
        "cell-1",
        "timings",
        TIMING_QUERY_LIMIT,
        "create",
        null,
      ])
    ).toEqual({
      steps: [
        expect.objectContaining({ id: "timing-1", step: "prepare_workspace" }),
      ],
      runs: [expect.objectContaining({ runId: "run-1", stepCount: 1 })],
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

    stream?.emit("snapshot", `{"timestamp":${String(SNAPSHOT_TIMESTAMP)}}`);

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy.mock.calls[0]?.[0]).toMatchObject({
      predicate: expect.any(Function),
    });
    expect(invalidateSpy.mock.calls[1]?.[0]).toMatchObject({
      queryKey: ["cells", "timings", "global"],
    });
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
