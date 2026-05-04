import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createChatTerminalRouteHarness,
  exercisePtyWebSocketActions,
  expectFailedWebSocketOpen,
  expectPtyRestartResponse,
  expectPtyStreamData,
  expectSeededPtyResize,
  handlePostRouteRequest,
  openMockWebSocket,
  seedRouteCell,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-chat-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 132;
const RESIZED_ROWS = 42;
const SERVER_URL = "http://127.0.0.1:4096";
const AGENT_SESSION_ID = "agent-session-1";
const createChatTerminalHarness = () =>
  createChatTerminalRouteHarness(TEST_CELL_ID);

function createDependencies(
  harness: ReturnType<typeof createChatTerminalHarness>
): any {
  const ensureAgentSession = vi.fn(async () => ({
    id: AGENT_SESSION_ID,
    cellId: TEST_CELL_ID,
    templateId: "template",
    provider: "opencode",
    status: "awaiting_input",
    workspacePath: "/tmp/mock-worktree",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modelId: "big-pickle",
    modelProviderId: "opencode",
  }));

  return createCellRouteTestDependencies({
    cellId: TEST_CELL_ID,
    overrides: {
      ensureAgentSession: ensureAgentSession as any,
      ensureChatTerminalSession: harness.ensureSession,
      readChatTerminalOutput: harness.readOutput,
      subscribeToChatTerminal: harness.subscribe,
      writeChatTerminalInput: harness.write,
      resizeChatTerminal: harness.resize,
      closeChatTerminalSession: harness.closeSession,
    },
  });
}

const createChatTerminalTestApp = (
  harness: ReturnType<typeof createChatTerminalHarness>
) => createCellRouteTestApp(createDependencies(harness));

const seedCell = () =>
  seedRouteCell({ id: TEST_CELL_ID, name: "Chat Terminal Cell" });

const createSeededChatTerminalApp = async () => {
  await seedCell();
  const harness = createChatTerminalHarness();
  return { harness, app: createChatTerminalTestApp(harness) };
};

const postSeededChatTerminalAction = async (
  action: "input" | "resize" | "restart",
  body?: Record<string, unknown>
) => {
  const { harness, app } = await createSeededChatTerminalApp();
  const response = await handlePostRouteRequest(
    app,
    `/api/cells/${TEST_CELL_ID}/chat/terminal/${action}`,
    body
  );
  return { harness, response };
};

const resetChatTerminalRouteState = async () => {
  vi.restoreAllMocks();
  await testDb.delete(cells);
  process.env.HIVE_OPENCODE_SERVER_URL = SERVER_URL;
};

describe("Cell chat terminal routes", () => {
  beforeAll(setupTestDb);

  beforeEach(resetChatTerminalRouteState);

  afterEach(() => {
    process.env.HIVE_OPENCODE_SERVER_URL = "";
  });

  it("streams chat terminal readiness, snapshot, and live output", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const deps = createDependencies(harness);
    const app = createCellRouteTestApp(deps);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/stream?themeMode=light`
      )
    );

    expect(deps.ensureAgentSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(harness.ensureSession).toHaveBeenCalledWith({
      cellId: TEST_CELL_ID,
      workspacePath: "/tmp/mock-worktree",
      opencodeSessionId: AGENT_SESSION_ID,
      opencodeServerUrl: SERVER_URL,
      opencodeThemeMode: "light",
      preferredModel: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
    });

    await expectPtyStreamData({
      response,
      missingMessage: "Response body reader unavailable",
      emit: () => harness.emit({ type: "data", chunk: "assistant> hello\n" }),
      expectedText: "assistant> hello",
    });
  });

  it("forwards chat terminal input to the chat terminal service", async () => {
    const { harness, response } = await postSeededChatTerminalAction("input", {
      data: "hello\n",
    });

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "hello\n");
  });

  it("resizes the chat terminal and returns updated dimensions", async () => {
    await expectSeededPtyResize({
      postAction: postSeededChatTerminalAction,
      cellId: TEST_CELL_ID,
      cols: RESIZED_COLS,
      rows: RESIZED_ROWS,
    });
  });

  it("restarts chat terminal sessions", async () => {
    const { harness, response } = await postSeededChatTerminalAction("restart");

    expectPtyRestartResponse({
      response,
      closeSession: harness.closeSession,
      ensureSession: harness.ensureSession,
      cellId: TEST_CELL_ID,
      ensureArgs: {
        cellId: TEST_CELL_ID,
        workspacePath: "/tmp/mock-worktree",
        opencodeSessionId: AGENT_SESSION_ID,
        opencodeServerUrl: SERVER_URL,
        opencodeThemeMode: "dark",
        preferredModel: { providerId: "opencode", modelId: "big-pickle" },
      },
    });
  });

  it("handles websocket input, resize, restart, and cached session context", async () => {
    const { harness, app } = await createSeededChatTerminalApp();
    const { hooks, ws } = await openMockWebSocket({
      app,
      path: "/api/cells/:id/chat/terminal/ws",
      id: "chat-ws-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
    });

    expect(harness.ensureSession).toHaveBeenCalled();
    await exercisePtyWebSocketActions({
      input: "ws hello\n",
      write: harness.write,
      hooks,
      resize: harness.resize,
      ws,
      closeSession: harness.closeSession,
      cellId: TEST_CELL_ID,
      rows: RESIZED_ROWS,
      deleteCell: () => testDb.delete(cells),
      cols: RESIZED_COLS,
    });
  });

  it("surfaces websocket startup errors when chat terminal init fails", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    harness.ensureSession.mockImplementationOnce(() => {
      throw new Error("Chat terminal bootstrap failed");
    });
    const deps = createDependencies(harness);
    const app = createCellRouteTestApp(deps);
    await expectFailedWebSocketOpen({
      app,
      path: "/api/cells/:id/chat/terminal/ws",
      id: "chat-ws-fail-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
      message: "Chat terminal bootstrap failed",
    });
  });
});
