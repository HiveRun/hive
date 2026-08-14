import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createCellTerminalRouteHarness,
  createRouteCellTerminalSession,
  exercisePtyWebSocketActions,
  expectBareReplacementTerminalStream,
  expectFailedWebSocketOpen,
  expectPtyRestartResponse,
  expectPtyStreamData,
  expectSeededPtyResize,
  expectTerminalEnvironment,
  handlePostRouteRequest,
  openMockWebSocket,
  readTerminalStreamEnvironment,
  seedRouteCell,
  seedRouteCellAndServiceWithPorts,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 140;
const RESIZED_ROWS = 48;
const FIRST_CALL_INDEX = 0;
const TERMINAL_PORT_ENVIRONMENT = {
  API_PORT: "43101",
  API_RPC_PORT: "43101",
  API_METRICS_PORT: "43102",
};
const createTerminalHarness = () =>
  createCellTerminalRouteHarness(TEST_CELL_ID);

const createDependencies = (
  harness: ReturnType<typeof createTerminalHarness>
) =>
  createCellRouteTestDependencies({
    cellId: TEST_CELL_ID,
    overrides: {
      ensureTerminalSession: harness.ensureSession,
      readTerminalOutput: harness.readOutput,
      subscribeToTerminal: harness.subscribe,
      writeTerminalInput: harness.write,
      resizeTerminal: harness.resize,
      closeTerminalSession: harness.closeSession,
    },
  });

const createTerminalTestApp = (
  harness: ReturnType<typeof createTerminalHarness>
) => createCellRouteTestApp(createDependencies(harness));

const seedCell = () =>
  seedRouteCell({ id: TEST_CELL_ID, name: "Terminal Cell" });

const createSeededTerminalApp = async () => {
  await seedCell();
  const harness = createTerminalHarness();
  return { harness, app: createTerminalTestApp(harness) };
};

const postSeededTerminalAction = async (
  action: "input" | "resize" | "restart",
  body?: Record<string, unknown>
) => {
  const { harness, app } = await createSeededTerminalApp();
  const response = await handlePostRouteRequest(
    app,
    `/api/cells/${TEST_CELL_ID}/terminal/${action}`,
    body
  );
  return { harness, response };
};

const resetTerminalRouteState = async () => {
  vi.restoreAllMocks();
  await testDb.delete(cells);
};

describe("Cell terminal routes", () => {
  beforeAll(setupTestDb);

  beforeEach(resetTerminalRouteState);

  it("streams terminal session readiness, snapshot, and live data", async () => {
    const { harness, app } = await createSeededTerminalApp();

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/terminal/stream`)
    );

    await expectPtyStreamData({
      response,
      missingMessage: "Response body reader unavailable",
      emit: () => harness.emit({ type: "data", chunk: "echo hi\n" }),
      expectedText: "echo hi",
    });
  });

  it("streams replacement terminal sessions with the cell contract", async () => {
    const { harness, app } = await createSeededTerminalApp();
    const session = createRouteCellTerminalSession({
      cellId: TEST_CELL_ID,
      sessionId: "replacement-cell-terminal",
      pid: 5678,
    });

    await expectBareReplacementTerminalStream({
      app,
      path: `/api/cells/${TEST_CELL_ID}/terminal/stream`,
      session,
      emit: () => harness.emit({ type: "session", session }),
    });
  });

  it("passes durable cell paths and persisted named ports to terminals", async () => {
    await seedRouteCellAndServiceWithPorts({
      cell: { id: TEST_CELL_ID, name: "Terminal Cell" },
      service: { id: "terminal-api-service", name: "api" },
      ports: [
        { name: "rpc", port: 43_101, primary: true },
        { name: "metrics", port: 43_102 },
      ],
    });
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const environment = await readTerminalStreamEnvironment(
      app,
      `/api/cells/${TEST_CELL_ID}/terminal/stream`,
      () => harness.ensureSession.mock.calls[0]?.[0]?.environment
    );
    expectTerminalEnvironment(
      environment,
      TEST_CELL_ID,
      TERMINAL_PORT_ENVIRONMENT
    );
  });

  it("forwards terminal input to the terminal service", async () => {
    const { harness, response } = await postSeededTerminalAction("input", {
      data: "pwd\n",
    });

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "pwd\n");
  });

  it("resizes the terminal and returns updated session dimensions", async () => {
    await expectSeededPtyResize({
      postAction: postSeededTerminalAction,
      cellId: TEST_CELL_ID,
      cols: RESIZED_COLS,
      rows: RESIZED_ROWS,
    });
  });

  it("restarts terminal sessions by closing then recreating the PTY", async () => {
    const { harness, response } = await postSeededTerminalAction("restart");

    expectPtyRestartResponse({
      response,
      closeSession: harness.closeSession,
      ensureSession: harness.ensureSession,
      cellId: TEST_CELL_ID,
      ensureArgs: { cellId: TEST_CELL_ID, workspacePath: "/tmp/mock-worktree" },
    });

    const closeCallOrder =
      harness.closeSession.mock.invocationCallOrder[FIRST_CALL_INDEX] ?? 0;
    const ensureCallOrder =
      harness.ensureSession.mock.invocationCallOrder[FIRST_CALL_INDEX] ?? 0;
    expect(closeCallOrder).toBeLessThan(ensureCallOrder);
  });

  it("handles websocket input, resize, restart, and cached session context", async () => {
    const { harness, app } = await createSeededTerminalApp();
    const { hooks, ws } = await openMockWebSocket({
      app,
      path: "/api/cells/:id/terminal/ws",
      id: "cell-terminal-ws-1",
      params: { id: TEST_CELL_ID },
    });

    await exercisePtyWebSocketActions({
      hooks,
      ws,
      cellId: TEST_CELL_ID,
      input: "ws pwd\n",
      cols: RESIZED_COLS,
      rows: RESIZED_ROWS,
      deleteCell: () => testDb.delete(cells),
      write: harness.write,
      resize: harness.resize,
      closeSession: harness.closeSession,
      invalidResize: {
        cols: 5000,
        rows: 2000,
        message: "Invalid websocket message",
      },
    });
  });

  it("surfaces websocket startup errors when terminal init fails", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    harness.ensureSession.mockImplementationOnce(() => {
      throw new Error("Terminal bootstrap failed");
    });
    const app = createTerminalTestApp(harness);
    await expectFailedWebSocketOpen({
      app,
      path: "/api/cells/:id/terminal/ws",
      id: "cell-terminal-ws-fail-1",
      params: { id: TEST_CELL_ID },
      message: "Terminal bootstrap failed",
    });
  });
});
