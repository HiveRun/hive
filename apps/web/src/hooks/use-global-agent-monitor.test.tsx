import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function makeCell(id: string): Cell {
  return makeCellFixture(id, WORKSPACE_ID, { templateId: "template-1" });
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

async function renderMonitor(queryClient: QueryClient) {
  renderHook(() => useGlobalAgentMonitor(), {
    wrapper: createWrapper(queryClient),
  });

  await waitFor(() => {
    expect(eventSource.instances).toHaveLength(1);
  });

  return eventSource.instances[0];
}

function emitMode(
  stream: MockEventSourceInstance | undefined,
  payload: Record<string, string> = { startMode: "plan", currentMode: "build" }
) {
  act(() => {
    stream?.emit("mode", JSON.stringify(payload));
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

  it("marks plan to build mode transitions as loading", async () => {
    const queryClient = new QueryClient();
    const stream = await startBuildTransition(queryClient, {
      startMode: "plan",
      currentMode: "build",
      modeUpdatedAt: "2026-04-08T00:00:00.000Z",
    });

    expect(stream?.url).toContain("/api/agents/sessions/session-1/events");
  });

  it("clears the transient loading state when a status event arrives", async () => {
    await withBuildTransition(async (queryClient, stream) => {
      act(() => {
        stream?.emit("status", JSON.stringify({ status: "completed" }));
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
