import {
  beforeAll,
  beforeEach,
  afterEach as cleanupAfterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp as createChatRouteTestApp,
  createCellRouteTestDependencies as createChatRouteTestDependencies,
  createChatTerminalRouteHarness,
  ptyRouteTestHelpers,
  readTerminalStreamEnvironment,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-chat-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 132;
const RESIZED_ROWS = 42;
const SERVER_URL = "http://127.0.0.1:4096";
const AGENT_SESSION_ID = "agent-session-1";
const CHAT_PORT_ENVIRONMENT = {
  WEB_APP_PORT: "43201",
  WEB_APP_HTTP_PORT: "43201",
  WEB_APP_METRICS_PORT: "43202",
};
const pty = ptyRouteTestHelpers;
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

  return createChatRouteTestDependencies({
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
) => createChatRouteTestApp(createDependencies(harness));

const seedCell = () =>
  pty.seedRouteCell({ id: TEST_CELL_ID, name: "Chat Terminal Cell" });

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
  const response = await pty.handlePostRouteRequest(
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

  cleanupAfterEach(() => {
    process.env.HIVE_OPENCODE_SERVER_URL = "";
  });

  it("streams chat terminal readiness, snapshot, and live output", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const deps = createDependencies(harness);
    const app = createChatRouteTestApp(deps);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/stream?themeMode=light`
      )
    );

    expect(deps.ensureAgentSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(harness.ensureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cellId: TEST_CELL_ID,
        workspacePath: "/tmp/mock-worktree",
        opencodeSessionId: AGENT_SESSION_ID,
        opencodeServerUrl: SERVER_URL,
        opencodeThemeMode: "light",
        preferredModel: {
          providerId: "opencode",
          modelId: "big-pickle",
        },
      })
    );

    await pty.expectPtyStreamData({
      response,
      missingMessage: "Response body reader unavailable",
      emit: () => harness.emit({ type: "data", chunk: "assistant> hello\n" }),
      expectedText: "assistant> hello",
    });
  });

  it("streams replacement chat sessions with the chat contract", async () => {
    const { harness, app } = await createSeededChatTerminalApp();
    const session = pty.createRouteCellTerminalSession({
      cellId: TEST_CELL_ID,
      sessionId: "replacement-chat-terminal",
      pid: 10_001,
    });

    await pty.expectBareReplacementTerminalStream({
      app,
      path: `/api/cells/${TEST_CELL_ID}/chat/terminal/stream`,
      session,
      emit: () => harness.emit({ type: "session", session }),
    });
  });

  it("passes durable cell paths and persisted named ports to OpenCode", async () => {
    await pty.seedRouteCellAndServiceWithPorts({
      cell: { id: TEST_CELL_ID, name: "Chat Terminal Cell" },
      service: { id: "chat-web-service", name: "web-app" },
      ports: [
        { name: "http", port: 43_201, primary: true },
        { name: "metrics", port: 43_202 },
      ],
    });
    const harness = createChatTerminalHarness();
    const app = createChatTerminalTestApp(harness);

    const environment = await readTerminalStreamEnvironment(
      app,
      `/api/cells/${TEST_CELL_ID}/chat/terminal/stream`,
      () => harness.ensureSession.mock.calls[0]?.[0]?.environment
    );
    pty.expectTerminalEnvironment(
      environment,
      TEST_CELL_ID,
      CHAT_PORT_ENVIRONMENT
    );
  });

  it("forwards chat terminal input to the chat terminal service", async () => {
    const { harness, response } = await postSeededChatTerminalAction("input", {
      data: "hello\n",
    });

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "hello\n");
  });

  it("resizes the chat terminal and returns updated dimensions", async () => {
    await pty.expectSeededPtyResize({
      postAction: postSeededChatTerminalAction,
      cellId: TEST_CELL_ID,
      cols: RESIZED_COLS,
      rows: RESIZED_ROWS,
    });
  });

  it("restarts chat terminal sessions", async () => {
    const { harness, response } = await postSeededChatTerminalAction("restart");

    pty.expectPtyRestartResponse({
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
    const { hooks, ws } = await pty.openMockWebSocket({
      app,
      path: "/api/cells/:id/chat/terminal/ws",
      id: "chat-ws-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
    });

    expect(harness.ensureSession).toHaveBeenCalled();
    await pty.exercisePtyWebSocketActions({
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
    const app = createChatRouteTestApp(deps);
    await pty.expectFailedWebSocketOpen({
      app,
      path: "/api/cells/:id/chat/terminal/ws",
      id: "chat-ws-fail-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
      message: "Chat terminal bootstrap failed",
    });
  });
});
