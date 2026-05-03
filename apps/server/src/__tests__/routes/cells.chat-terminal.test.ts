// jscpd:ignore-start
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
  assertWebSocketMessage,
  assertWebSocketType,
  closeWebSocketNormally,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createChatTerminalRouteHarness,
  createEventStreamReader,
  createMockWebSocket,
  getWebSocketHooks,
  seedRouteCell,
  sendWebSocketJson,
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

describe("Cell chat terminal routes", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete(cells);
    process.env.HIVE_OPENCODE_SERVER_URL = SERVER_URL;
  });

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

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
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

    const reader = await createEventStreamReader(
      response,
      "Response body reader unavailable"
    );
    const firstText = await reader.read();
    expect(firstText).toContain("event: ready");
    const snapshotText = await reader.read();
    expect(snapshotText).toContain("event: snapshot");

    harness.emit({ type: "data", chunk: "assistant> hello\n" });
    const dataText = await reader.read();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("assistant> hello");

    await reader.cancel();
  });

  it("forwards chat terminal input to the chat terminal service", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = createChatTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/input`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: "hello\n" }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "hello\n");
  });

  it("resizes the chat terminal and returns updated dimensions", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = createChatTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/resize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: RESIZED_COLS, rows: RESIZED_ROWS }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.resize).toHaveBeenCalledWith(
      TEST_CELL_ID,
      RESIZED_COLS,
      RESIZED_ROWS
    );

    const payload = (await response.json()) as {
      ok: boolean;
      session: { cols: number; rows: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.session.cols).toBe(RESIZED_COLS);
    expect(payload.session.rows).toBe(RESIZED_ROWS);
  });

  it("restarts chat terminal sessions", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const app = createChatTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/chat/terminal/restart`,
        {
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.closeSession).toHaveBeenCalledWith(TEST_CELL_ID);
    expect(harness.ensureSession).toHaveBeenCalledWith({
      cellId: TEST_CELL_ID,
      workspacePath: "/tmp/mock-worktree",
      opencodeSessionId: AGENT_SESSION_ID,
      opencodeServerUrl: SERVER_URL,
      opencodeThemeMode: "dark",
      preferredModel: {
        providerId: "opencode",
        modelId: "big-pickle",
      },
    });
  });

  it("handles websocket input, resize, restart, and cached session context", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    const deps = createDependencies(harness);
    const app = createCellRouteTestApp(deps);
    const hooks = getWebSocketHooks(app, "/api/cells/:id/chat/terminal/ws");
    const ws = createMockWebSocket({
      id: "chat-ws-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
    });

    await hooks.open?.(ws.socket);
    expect(harness.ensureSession).toHaveBeenCalled();
    assertWebSocketType(ws, "ready");

    await sendWebSocketJson(hooks, ws.socket, {
      type: "input",
      data: "ws hello\n",
    });
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "ws hello\n");

    await sendWebSocketJson(hooks, ws.socket, {
      type: "resize",
      cols: RESIZED_COLS,
      rows: RESIZED_ROWS,
    });
    expect(harness.resize).toHaveBeenCalledWith(
      TEST_CELL_ID,
      RESIZED_COLS,
      RESIZED_ROWS
    );

    await testDb.delete(cells);
    await sendWebSocketJson(hooks, ws.socket, {
      type: "input",
      data: "cached\n",
    });
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "cached\n");

    await sendWebSocketJson(hooks, ws.socket, { type: "restart" });
    expect(harness.closeSession).toHaveBeenCalledWith(TEST_CELL_ID);
    assertWebSocketMessage(
      ws,
      (entry) => entry.type === "snapshot" && typeof entry.output === "string"
    );

    closeWebSocketNormally(hooks, ws.socket);
    expect(ws.isClosed()).toBeFalsy();
  });

  it("surfaces websocket startup errors when chat terminal init fails", async () => {
    await seedCell();
    const harness = createChatTerminalHarness();
    harness.ensureSession.mockImplementationOnce(() => {
      throw new Error("Chat terminal bootstrap failed");
    });
    const deps = createDependencies(harness);
    const app = createCellRouteTestApp(deps);
    const hooks = getWebSocketHooks(app, "/api/cells/:id/chat/terminal/ws");
    const ws = createMockWebSocket({
      id: "chat-ws-fail-1",
      params: { id: TEST_CELL_ID },
      query: { themeMode: "light" },
    });

    await hooks.open?.(ws.socket);

    assertWebSocketMessage(
      ws,
      (entry) =>
        entry.type === "error" &&
        entry.message === "Chat terminal bootstrap failed"
    );
    expect(ws.isClosed()).toBeTruthy();
  });
});
// jscpd:ignore-end
