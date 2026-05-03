import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createEventSourceMock,
  createWrapper,
  registerEventSourceMockLifecycle,
} from "./event-source-test-utils";
import { useCellTimingStream } from "./use-cell-timing-stream";

const eventSource = createEventSourceMock();
const INVALIDATION_DEBOUNCE_MS = 350;

function renderTimingStream(
  options?: Parameters<typeof useCellTimingStream>[1]
) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const result = renderHook(() => useCellTimingStream("cell-1", options), {
    wrapper: createWrapper(queryClient),
  });

  return {
    invalidateSpy,
    stream: eventSource.instances[0],
    unmount: result.unmount,
  };
}

function renderCreateTimingStream() {
  const state = renderTimingStream({ workflow: "create" });
  if (!state.stream) {
    throw new Error("Expected timing stream to be created");
  }
  return { ...state, stream: state.stream };
}

describe("useCellTimingStream", () => {
  registerEventSourceMockLifecycle(eventSource, { fakeTimers: true });

  it("subscribes to timing SSE and invalidates timing queries", async () => {
    const { invalidateSpy, stream } = renderCreateTimingStream();

    expect(eventSource.instances).toHaveLength(1);
    expect(stream?.url).toContain("/api/cells/cell-1/timings/stream");
    expect(stream?.url).toContain("workflow=create");

    stream?.emit("timing", '{"cellId":"cell-1","workflow":"create"}');
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS);
    await Promise.resolve();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    expect(invalidateSpy.mock.calls[0]?.[0]).toMatchObject({
      predicate: expect.any(Function),
    });
  });

  it("invalidates timing queries on snapshot events", () => {
    const { invalidateSpy, stream } = renderCreateTimingStream();

    stream?.emit("snapshot", '{"timestamp":123}');

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("debounces timing-event invalidations", async () => {
    const { invalidateSpy, stream } = renderCreateTimingStream();

    stream?.emit("timing", '{"step":"one"}');
    stream?.emit("timing", '{"step":"two"}');
    stream?.emit("timing", '{"step":"three"}');

    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS);
    await Promise.resolve();

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe when disabled", () => {
    renderTimingStream({ enabled: false });

    expect(eventSource.instances).toHaveLength(0);
  });

  it("closes the event source on unmount", () => {
    const { stream, unmount } = renderTimingStream();

    expect(eventSource.instances).toHaveLength(1);
    expect(stream?.closed).toBe(false);

    unmount();

    expect(stream?.closed).toBe(true);
  });
});
