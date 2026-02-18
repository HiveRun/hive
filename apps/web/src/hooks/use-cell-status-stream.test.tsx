import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "@/queries/cells";
import { useCellStatusStream } from "./use-cell-status-stream";

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
const WORKSPACE_ID = "workspace-1";

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

function makeCell(id: string, status: Cell["status"]): Cell {
  return {
    id,
    name: `Cell ${id}`,
    description: null,
    templateId: "template",
    workspacePath: `/tmp/${id}`,
    workspaceId: WORKSPACE_ID,
    workspaceRootPath: "/tmp/workspace",
    opencodeSessionId: null,
    opencodeCommand: null,
    createdAt: new Date().toISOString(),
    status,
    lastSetupError: undefined,
    branchName: undefined,
    baseCommit: undefined,
  };
}

describe("useCellStatusStream", () => {
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

  it("subscribes to workspace status stream", () => {
    const queryClient = new QueryClient();

    renderHook(() => useCellStatusStream(WORKSPACE_ID), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockEventSourceInstances).toHaveLength(1);
    const stream = mockEventSourceInstances[0];
    expect(stream?.url).toContain(
      `/api/cells/workspace/${WORKSPACE_ID}/stream`
    );
  });

  it("removes and re-adds cells through stream events", () => {
    const queryClient = new QueryClient();
    const cell = makeCell("cell-1", "ready");

    queryClient.setQueryData(["cells", WORKSPACE_ID], [cell]);
    queryClient.setQueryData(["cells", cell.id], cell);

    renderHook(() => useCellStatusStream(WORKSPACE_ID), {
      wrapper: createWrapper(queryClient),
    });

    const stream = mockEventSourceInstances[0];
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
