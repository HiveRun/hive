import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@/queries/agents";
import type { Cell } from "@/queries/cells";
import {
  createEventSourceMock,
  createWrapper,
  type MockEventSourceInstance,
  makeCellFixture,
  registerEventSourceMockLifecycle,
} from "./event-source-test-utils";
import { useGlobalAgentMonitor } from "./use-global-agent-monitor";

const WORKSPACE_ID = "workspace-1";
const CELL_ID = "cell-1";
const MODE_TRANSITION_LOADING_TIMEOUT_MS = 4000;
const MODE_TRANSITION_WAIT_BUFFER_MS = 100;
const EXTENDED_TEST_TIMEOUT_MS = 10_000;

const eventSource = createEventSourceMock();
const sessionState = vi.hoisted(() => ({
  workspaceId: "workspace-1" as string | undefined,
  statuses: new Map<string, AgentSession["status"]>(),
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

vi.mock("@/hooks/use-active-workspace", () => ({
  useActiveWorkspace: () => ({
    activeWorkspace: sessionState.workspaceId
      ? { id: sessionState.workspaceId }
      : undefined,
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
      queryFn: async () =>
        makeSession(cellId, sessionState.statuses.get(cellId)),
    }),
  },
}));

function makeCell(id: string): Cell {
  return makeCellFixture(id, WORKSPACE_ID, { templateId: "template-1" });
}

function makeSession(
  cellId: string,
  status: AgentSession["status"] = "working"
): AgentSession {
  return {
    id: cellId === CELL_ID ? "session-1" : `session-${cellId}`,
    cellId,
    templateId: "template-1",
    provider: "opencode",
    status,
    workspacePath: `/tmp/${cellId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startMode: "plan",
    currentMode: "plan",
  };
}

async function renderMonitor(queryClient: QueryClient) {
  renderHook(() => useGlobalAgentMonitor(), {
    wrapper: createWrapper(queryClient),
  });

  await waitFor(() => {
    expect(eventSource.instances).toHaveLength(1);
  });

  const stream = eventSource.instances[0];
  act(() => {
    stream?.emit("ready");
  });
  return stream;
}

function emitMode(
  stream: MockEventSourceInstance | undefined,
  payload: Record<string, string> = { startMode: "plan", currentMode: "build" }
) {
  act(() => {
    stream?.emit(
      "mode",
      JSON.stringify({ sessionId: "session-1", ...payload })
    );
  });
}

async function expectSessionUpdate(
  queryClient: QueryClient,
  expected: Partial<AgentSession>
) {
  await waitFor(() => {
    expect(queryClient.getQueryData(["agent-session", CELL_ID])).toEqual(
      expect.objectContaining(expected)
    );
  });
}

async function expectCellSessionStatus(
  queryClient: QueryClient,
  cellId: string,
  status: AgentSession["status"]
) {
  await waitFor(() => {
    expect(
      queryClient.getQueryData<AgentSession>(["agent-session", cellId])?.status
    ).toBe(status);
  });
}

async function startBuildTransition(
  queryClient: QueryClient,
  payload: Record<string, string> = { startMode: "plan", currentMode: "build" }
) {
  const stream = await renderMonitor(queryClient);
  emitMode(stream, payload);
  await expectSessionUpdate(queryClient, {
    currentMode: "build",
    status: "starting",
  });
  return stream;
}

async function withBuildTransition(
  run: (
    queryClient: QueryClient,
    stream: MockEventSourceInstance | undefined
  ) => Promise<void> | void
) {
  const queryClient = new QueryClient();
  const stream = await startBuildTransition(queryClient);
  await run(queryClient, stream);
}

describe("useGlobalAgentMonitor", () => {
  registerEventSourceMockLifecycle(eventSource);
  beforeEach(() => {
    sessionState.workspaceId = WORKSPACE_ID;
    sessionState.statuses.clear();
    vi.mocked(toast.info).mockClear();
    vi.stubGlobal("Audio", function MockAudio() {
      return {
        currentTime: 0,
        volume: 0,
        play: () => Promise.resolve(),
      };
    });
  });

  it("marks plan to build mode transitions as loading", async () => {
    const queryClient = new QueryClient();
    const stream = await startBuildTransition(queryClient, {
      startMode: "plan",
      currentMode: "build",
      modeUpdatedAt: "2026-04-08T00:00:00.000Z",
    });

    expect(stream?.url).toContain("/api/agents/events");
  });

  it("uses one stream for multiple ready cells and routes by session", async () => {
    const queryClient = new QueryClient();
    const secondCellId = "cell-2";
    queryClient.setQueryDefaults(["cells", WORKSPACE_ID], {
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(
      ["agent-session", secondCellId],
      makeSession(secondCellId)
    );

    const stream = await renderMonitor(queryClient);
    act(() => {
      queryClient.setQueryData(
        ["cells", WORKSPACE_ID],
        [makeCell(CELL_ID), makeCell(secondCellId)]
      );
    });

    act(() => {
      stream?.emit(
        "status",
        JSON.stringify({
          sessionId: `session-${secondCellId}`,
          status: "completed",
        })
      );
    });

    await expectCellSessionStatus(queryClient, secondCellId, "completed");
    await expectCellSessionStatus(queryClient, CELL_ID, "working");
    expect(eventSource.instances).toHaveLength(1);
  });

  it("keeps provider error details from status events", async () => {
    const queryClient = new QueryClient();
    const stream = await renderMonitor(queryClient);

    act(() => {
      stream?.emit(
        "status",
        JSON.stringify({
          sessionId: "session-1",
          status: "error",
          error: "OpenAI authorization failed",
        })
      );
    });

    await expectSessionUpdate(queryClient, {
      status: "error",
      errorMessage: "OpenAI authorization failed",
    });
  });

  it("refreshes session state after the global stream reconnects", async () => {
    const queryClient = new QueryClient();
    const stream = await renderMonitor(queryClient);
    await expectSessionUpdate(queryClient, { status: "working" });

    sessionState.statuses.set(CELL_ID, "awaiting_input");
    act(() => {
      stream?.onerror?.();
      stream?.emit("ready");
    });

    await expectSessionUpdate(queryClient, { status: "awaiting_input" });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("stops routing events for a workspace as soon as it is deselected", async () => {
    const queryClient = new QueryClient();
    const { rerender } = renderHook(() => useGlobalAgentMonitor(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => {
      expect(eventSource.instances).toHaveLength(1);
    });
    const stream = eventSource.instances[0];
    act(() => {
      stream?.emit("ready");
    });
    await expectSessionUpdate(queryClient, { status: "working" });

    sessionState.workspaceId = undefined;
    rerender();
    act(() => {
      stream?.emit(
        "status",
        JSON.stringify({ sessionId: "session-1", status: "completed" })
      );
    });

    await expectCellSessionStatus(queryClient, CELL_ID, "working");
    expect(eventSource.instances).toHaveLength(1);
  });

  it("clears the transient loading state when a status event arrives", async () => {
    await withBuildTransition(async (queryClient, stream) => {
      act(() => {
        stream?.emit(
          "status",
          JSON.stringify({ sessionId: "session-1", status: "completed" })
        );
      });

      await expectSessionUpdate(queryClient, { status: "completed" });
    });
  });

  it("restores the previous status on a later non-transition mode update", async () => {
    await withBuildTransition(async (queryClient, stream) => {
      emitMode(stream, { startMode: "plan", currentMode: "plan" });
      await expectSessionUpdate(queryClient, {
        currentMode: "plan",
        status: "working",
      });
    });
  });

  it(
    "restores the previous status if no newer status arrives",
    async () => {
      const queryClient = new QueryClient();
      await startBuildTransition(queryClient);

      await new Promise((resolve) => {
        setTimeout(
          resolve,
          MODE_TRANSITION_LOADING_TIMEOUT_MS + MODE_TRANSITION_WAIT_BUFFER_MS
        );
      });

      await expectSessionUpdate(queryClient, { status: "working" });
    },
    EXTENDED_TEST_TIMEOUT_MS
  );

  it("restores the previous status when the stream errors", async () => {
    await withBuildTransition(async (queryClient, stream) => {
      act(() => {
        stream?.onerror?.();
      });

      await expectSessionUpdate(queryClient, { status: "working" });
    });
  });
});
