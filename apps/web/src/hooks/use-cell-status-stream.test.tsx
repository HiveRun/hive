import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Cell } from "@/queries/cells";
import {
  createEventSourceMock,
  createWrapper,
  makeCellFixture,
  registerEventSourceMockLifecycle,
} from "./event-source-test-utils";
import { useCellStatusStream } from "./use-cell-status-stream";

const eventSource = createEventSourceMock();
const WORKSPACE_ID = "workspace-1";

function makeCell(id: string, status: Cell["status"]): Cell {
  return makeCellFixture(id, WORKSPACE_ID, { status });
}

function renderStatusStream(queryClient = new QueryClient()) {
  renderHook(() => useCellStatusStream(WORKSPACE_ID), {
    wrapper: createWrapper(queryClient),
  });

  return { queryClient, stream: eventSource.instances[0] };
}

describe("useCellStatusStream", () => {
  registerEventSourceMockLifecycle(eventSource);

  it("subscribes to workspace status stream", () => {
    const { stream } = renderStatusStream();

    expect(eventSource.instances).toHaveLength(1);
    expect(stream?.url).toContain(
      `/api/cells/workspace/${WORKSPACE_ID}/stream`
    );
  });

  it("removes and re-adds cells through stream events", () => {
    const queryClient = new QueryClient();
    const cell = makeCell("cell-1", "ready");

    queryClient.setQueryData(["cells", WORKSPACE_ID], [cell]);
    queryClient.setQueryData(["cells", cell.id], cell);

    const { stream } = renderStatusStream(queryClient);
    expect(stream).toBeDefined();

    stream?.emit("cell_removed", JSON.stringify({ id: cell.id }));
    expect(queryClient.getQueryData(["cells", WORKSPACE_ID])).toEqual([]);
    expect(queryClient.getQueryData(["cells", cell.id])).toBeUndefined();

    stream?.emit("cell", JSON.stringify({ ...cell, status: "error" }));
    expect(queryClient.getQueryData(["cells", WORKSPACE_ID])).toEqual([
      expect.objectContaining({ id: cell.id, status: "error" }),
    ]);
  });
});
