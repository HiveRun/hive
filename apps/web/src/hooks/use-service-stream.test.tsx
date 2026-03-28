import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellServiceSummary } from "@/queries/cells";
import { useServiceStream } from "./use-service-stream";

const { joinServiceRealtimeChannel } = vi.hoisted(() => ({
  joinServiceRealtimeChannel: vi.fn(),
}));

vi.mock("@/lib/realtime-channels", () => ({
  joinServiceRealtimeChannel,
}));

const CELL_ID = "cell-1";
const SERVICES_QUERY_KEY = ["cells", CELL_ID, "services", true] as const;

function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeService(id: string, status: string): CellServiceSummary {
  return {
    id,
    name: `Service ${id}`,
    type: "process",
    status,
    command: "bun dev",
    cwd: "/workspace",
  };
}

describe("useServiceStream", () => {
  beforeEach(() => {
    joinServiceRealtimeChannel.mockReset();
    joinServiceRealtimeChannel.mockImplementation((options) => ({
      unsubscribe: vi.fn(),
      __options: options,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the service realtime channel and invalidates on join", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useServiceStream(CELL_ID, { includeResources: true }), {
      wrapper: createWrapper(queryClient),
    });

    expect(joinServiceRealtimeChannel).toHaveBeenCalledTimes(1);
    const call = joinServiceRealtimeChannel.mock.calls[0]?.[0];
    expect(call?.cellId).toBe(CELL_ID);

    call?.onJoin?.();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: SERVICES_QUERY_KEY,
    });
  });

  it("patches service query snapshots from channel payloads", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(SERVICES_QUERY_KEY, [
      makeService("svc-1", "starting"),
    ]);

    renderHook(() => useServiceStream(CELL_ID, { includeResources: true }), {
      wrapper: createWrapper(queryClient),
    });

    const call = joinServiceRealtimeChannel.mock.calls[0]?.[0];
    call?.handlers.service_snapshot(makeService("svc-1", "running"));

    expect(queryClient.getQueryData(SERVICES_QUERY_KEY)).toEqual([
      expect.objectContaining({ id: "svc-1", status: "running" }),
    ]);
  });

  it("does not subscribe when disabled", () => {
    const queryClient = new QueryClient();

    renderHook(() => useServiceStream(CELL_ID, { enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    expect(joinServiceRealtimeChannel).not.toHaveBeenCalled();
  });
});
