import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@/queries/agents";
import type { Cell } from "@/queries/cells";
import { useGlobalAgentMonitor } from "./use-global-agent-monitor";

const WORKSPACE_ID = "workspace-1";
const CELL_ID = "cell-1";
const MODE_TRANSITION_LOADING_TIMEOUT_MS = 4000;
const MODE_TRANSITION_WAIT_BUFFER_MS = 100;
const EXTENDED_TEST_TIMEOUT_MS = 10_000;

type MockEventSourceInstance = {
  url: string;
  closed: boolean;
  addEventListener: (
    event: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  close: () => void;
  emit: (event: string, data?: string) => void;
  onerror: (() => void) | null;
};

const mockEventSourceInstances: MockEventSourceInstance[] = [];

vi.mock("@/hooks/use-active-workspace", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: { id: WORKSPACE_ID },
  }),
}));

vi.mock("@/queries/cells", () => ({
  cellQueries: {
    all: (workspaceId: string) => ({
      queryKey: ["cells", workspaceId] as const,
      queryFn: async () => [makeCell(CELL_ID)],
    }),
  },
}));

vi.mock("@/queries/agents", () => ({
  agentQueries: {
    sessionByCell: (cellId: string) => ({
      queryKey: ["agent-session", cellId] as const,
      queryFn: async () => makeSession(cellId),
    }),
  },
}));

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
          continue;
        }

        listener.handleEvent(message);
      }
    },
    onerror: null,
  };

  mockEventSourceInstances.push(instance);
  return instance;
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeCell(id: string): Cell {
  return {
    id,
    name: `Cell ${id}`,
    description: null,
    templateId: "template-1",
    workspacePath: `/tmp/${id}`,
    workspaceId: WORKSPACE_ID,
    workspaceRootPath: "/tmp/workspace",
    opencodeSessionId: null,
    opencodeCommand: null,
    createdAt: new Date().toISOString(),
    status: "ready",
    lastSetupError: undefined,
    branchName: undefined,
    baseCommit: undefined,
  };
}

function makeSession(cellId: string): AgentSession {
  return {
    id: "session-1",
    cellId,
    templateId: "template-1",
    provider: "opencode",
    status: "working",
    workspacePath: `/tmp/${cellId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startMode: "plan",
    currentMode: "plan",
  };
}

describe("useGlobalAgentMonitor", () => {
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

  it("marks plan to build mode transitions as loading", async () => {
    const queryClient = new QueryClient();

    renderHook(() => useGlobalAgentMonitor(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockEventSourceInstances).toHaveLength(1);
    });

    const stream = mockEventSourceInstances[0];
    expect(stream?.url).toContain("/api/agents/sessions/session-1/events");

    act(() => {
      stream?.emit(
        "mode",
        JSON.stringify({
          startMode: "plan",
          currentMode: "build",
          modeUpdatedAt: "2026-04-08T00:00:00.000Z",
        })
      );
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({
          currentMode: "build",
          status: "starting",
        })
      );
    });
  });

  it("clears the transient loading state when a status event arrives", async () => {
    const queryClient = new QueryClient();

    renderHook(() => useGlobalAgentMonitor(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockEventSourceInstances).toHaveLength(1);
    });

    const stream = mockEventSourceInstances[0];

    act(() => {
      stream?.emit(
        "mode",
        JSON.stringify({
          startMode: "plan",
          currentMode: "build",
        })
      );
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({ status: "starting" })
      );
    });

    act(() => {
      stream?.emit("status", JSON.stringify({ status: "completed" }));
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({ status: "completed" })
      );
    });
  });

  it("restores the previous status on a later non-transition mode update", async () => {
    const queryClient = new QueryClient();

    renderHook(() => useGlobalAgentMonitor(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockEventSourceInstances).toHaveLength(1);
    });

    const stream = mockEventSourceInstances[0];

    act(() => {
      stream?.emit(
        "mode",
        JSON.stringify({
          startMode: "plan",
          currentMode: "build",
        })
      );
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({
          currentMode: "build",
          status: "starting",
        })
      );
    });

    act(() => {
      stream?.emit(
        "mode",
        JSON.stringify({
          startMode: "plan",
          currentMode: "plan",
        })
      );
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({
          currentMode: "plan",
          status: "working",
        })
      );
    });
  });

  it(
    "restores the previous status if no newer status arrives",
    async () => {
      const queryClient = new QueryClient();

      renderHook(() => useGlobalAgentMonitor(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockEventSourceInstances).toHaveLength(1);
      });

      const stream = mockEventSourceInstances[0];

      act(() => {
        stream?.emit(
          "mode",
          JSON.stringify({
            startMode: "plan",
            currentMode: "build",
          })
        );
      });

      await waitFor(() => {
        expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
          expect.objectContaining({ status: "starting" })
        );
      });

      await new Promise((resolve) => {
        setTimeout(
          resolve,
          MODE_TRANSITION_LOADING_TIMEOUT_MS + MODE_TRANSITION_WAIT_BUFFER_MS
        );
      });

      await waitFor(() => {
        expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
          expect.objectContaining({ status: "working" })
        );
      });
    },
    EXTENDED_TEST_TIMEOUT_MS
  );

  it("restores the previous status when the stream errors", async () => {
    const queryClient = new QueryClient();

    renderHook(() => useGlobalAgentMonitor(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockEventSourceInstances).toHaveLength(1);
    });

    const stream = mockEventSourceInstances[0];

    act(() => {
      stream?.emit(
        "mode",
        JSON.stringify({
          startMode: "plan",
          currentMode: "build",
        })
      );
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({ status: "starting" })
      );
    });

    act(() => {
      stream?.onerror?.();
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
        expect.objectContaining({ status: "working" })
      );
    });
  });
});
