import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "@/queries/cells";
import { useCellStatusStream } from "./use-cell-status-stream";

const { joinWorkspaceRealtimeChannel } = vi.hoisted(() => ({
  joinWorkspaceRealtimeChannel: vi.fn(),
}));

vi.mock("@/lib/realtime-channels", () => ({
  joinWorkspaceRealtimeChannel,
}));

const WORKSPACE_ID = "workspace-1";

function makeCell(id: string, status: Cell["status"]): Cell {
  return {
    id,
    name: `Cell ${id}`,
    workspaceId: WORKSPACE_ID,
    description: null,
    templateId: "template-1",
    workspaceRootPath: "/workspace",
    workspacePath: "/workspace",
    opencodeSessionId: null,
    opencodeCommand: null,
    createdAt: new Date().toISOString(),
    status,
    lastSetupError: status === "error" ? "boom" : undefined,
    branchName: null,
    baseCommit: null,
    updatedAt: new Date().toISOString(),
  };
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useCellStatusStream", () => {
  beforeEach(() => {
    joinWorkspaceRealtimeChannel.mockReset();
    joinWorkspaceRealtimeChannel.mockImplementation((options) => ({
      unsubscribe: vi.fn(),
      __options: options,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the workspace realtime channel and invalidates on join", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useCellStatusStream(WORKSPACE_ID), {
      wrapper: createWrapper(queryClient),
    });

    expect(joinWorkspaceRealtimeChannel).toHaveBeenCalledTimes(1);
    const call = joinWorkspaceRealtimeChannel.mock.calls[0]?.[0];
    expect(call?.workspaceId).toBe(WORKSPACE_ID);

    call?.onJoin?.();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["cells", WORKSPACE_ID],
    });
  });

  it("replaces cached cell snapshots instead of merging stale fields", () => {
    const queryClient = new QueryClient();
    const staleCell = {
      ...makeCell("cell-1", "error"),
      lastSetupError: "stale failure",
    };

    queryClient.setQueryData(["cells", WORKSPACE_ID], [staleCell]);
    queryClient.setQueryData(["cells", staleCell.id], staleCell);

    renderHook(() => useCellStatusStream(WORKSPACE_ID), {
      wrapper: createWrapper(queryClient),
    });

    const call = joinWorkspaceRealtimeChannel.mock.calls[0]?.[0];
    const nextCell = {
      ...makeCell(staleCell.id, "ready"),
      lastSetupError: undefined,
    };

    call?.handlers.cell_snapshot(nextCell);

    expect(queryClient.getQueryData(["cells", WORKSPACE_ID])).toEqual([
      expect.objectContaining({ id: staleCell.id, status: "ready" }),
    ]);
    expect(queryClient.getQueryData(["cells", staleCell.id])).toEqual(
      expect.objectContaining({ id: staleCell.id, status: "ready" })
    );
    expect(
      (queryClient.getQueryData(["cells", staleCell.id]) as Cell | undefined)
        ?.lastSetupError
    ).toBeUndefined();
  });

  it("removes deleted cells from cache", () => {
    const queryClient = new QueryClient();
    const existingCell = makeCell("cell-2", "ready");

    queryClient.setQueryData(["cells", WORKSPACE_ID], [existingCell]);
    queryClient.setQueryData(["cells", existingCell.id], existingCell);

    renderHook(() => useCellStatusStream(WORKSPACE_ID), {
      wrapper: createWrapper(queryClient),
    });

    const call = joinWorkspaceRealtimeChannel.mock.calls[0]?.[0];
    call?.handlers.cell_removed({ id: existingCell.id });

    expect(queryClient.getQueryData(["cells", WORKSPACE_ID])).toEqual([]);
    expect(
      queryClient.getQueryData(["cells", existingCell.id])
    ).toBeUndefined();
  });
});
