import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellTimingResponse } from "@/queries/cells";
import { useCellTimingStream } from "./use-cell-timing-stream";

const { joinTimingRealtimeChannel } = vi.hoisted(() => ({
  joinTimingRealtimeChannel: vi.fn(),
}));

vi.mock("@/lib/realtime-channels", () => ({
  joinTimingRealtimeChannel,
}));

const CELL_ID = "cell-1";
const TIMING_QUERY_LIMIT = 300;
const TIMING_QUERY_KEY = [
  "cells",
  CELL_ID,
  "timings",
  TIMING_QUERY_LIMIT,
  "create",
  null,
] as const;

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
    joinTimingRealtimeChannel.mockReset();
    joinTimingRealtimeChannel.mockImplementation((options) => ({
      unsubscribe: vi.fn(),
      __options: options,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the timing realtime channel and invalidates on join", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useCellTimingStream(CELL_ID, { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    expect(joinTimingRealtimeChannel).toHaveBeenCalledTimes(1);
    const call = joinTimingRealtimeChannel.mock.calls[0]?.[0];
    expect(call?.cellId).toBe(CELL_ID);

    call?.onJoin?.();

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("patches matching timing queries from channel payloads", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(TIMING_QUERY_KEY, seedTimingResponse());

    renderHook(() => useCellTimingStream(CELL_ID, { workflow: "create" }), {
      wrapper: createWrapper(queryClient),
    });

    const call = joinTimingRealtimeChannel.mock.calls[0]?.[0];
    call?.handlers.timing_snapshot({
      id: "timing-1",
      cellId: CELL_ID,
      cellName: "Cell 1",
      workspaceId: "workspace-1",
      templateId: "template-1",
      runId: "run-1",
      workflow: "create",
      step: "prepare_workspace",
      status: "ok",
      attempt: 1,
      error: null,
      metadata: {},
      durationMs: 12,
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    expect(
      queryClient.getQueryData<CellTimingResponse>(TIMING_QUERY_KEY)
    ).toEqual({
      steps: [
        expect.objectContaining({ id: "timing-1", step: "prepare_workspace" }),
      ],
      runs: [expect.objectContaining({ runId: "run-1", stepCount: 1 })],
    });
  });

  it("does not subscribe when disabled", () => {
    const queryClient = new QueryClient();

    renderHook(() => useCellTimingStream(CELL_ID, { enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(joinTimingRealtimeChannel).not.toHaveBeenCalled();
  });
});
