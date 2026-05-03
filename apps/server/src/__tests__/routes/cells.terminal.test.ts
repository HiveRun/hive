// jscpd:ignore-start
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cells } from "../../schema/cells";
import { setupTestDb, testDb } from "../test-db";
import {
  assertWebSocketMessage,
  assertWebSocketType,
  closeWebSocketNormally,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createCellTerminalRouteHarness,
  createEventStreamReader,
  createMockWebSocket,
  getWebSocketHooks,
  seedRouteCell,
  sendWebSocketJson,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 140;
const RESIZED_ROWS = 48;
const FIRST_CALL_INDEX = 0;
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

describe("Cell terminal routes", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete(cells);
  });

  it("streams terminal session readiness, snapshot, and live data", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/terminal/stream`)
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = await createEventStreamReader(
      response,
      "Response body reader unavailable"
    );
    const firstText = await reader.read();
    expect(firstText).toContain("event: ready");
    const snapshotText = await reader.read();
    expect(snapshotText).toContain("event: snapshot");

    harness.emit({ type: "data", chunk: "echo hi\n" });
    const dataText = await reader.read();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("echo hi");

    await reader.cancel();
  });

  it("forwards terminal input to the terminal service", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/terminal/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "pwd\n" }),
      })
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "pwd\n");
  });

  it("resizes the terminal and returns updated session dimensions", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/terminal/resize`,
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

  it("restarts terminal sessions by closing then recreating the PTY", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/terminal/restart`,
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
    });

    const closeCallOrder =
      harness.closeSession.mock.invocationCallOrder[FIRST_CALL_INDEX] ?? 0;
    const ensureCallOrder =
      harness.ensureSession.mock.invocationCallOrder[FIRST_CALL_INDEX] ?? 0;
    expect(closeCallOrder).toBeLessThan(ensureCallOrder);
  });

  it("handles websocket input, resize, restart, and cached session context", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);
    const hooks = getWebSocketHooks(app, "/api/cells/:id/terminal/ws");
    const ws = createMockWebSocket({
      id: "cell-terminal-ws-1",
      params: { id: TEST_CELL_ID },
    });

    await hooks.open?.(ws.socket);
    assertWebSocketType(ws, "ready");

    await sendWebSocketJson(hooks, ws.socket, {
      type: "input",
      data: "ws pwd\n",
    });
    expect(harness.write).toHaveBeenCalledWith(TEST_CELL_ID, "ws pwd\n");

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

    await sendWebSocketJson(hooks, ws.socket, {
      type: "resize",
      cols: 5000,
      rows: 2000,
    });
    expect(harness.resize).toHaveBeenCalledTimes(1);
    assertWebSocketMessage(
      ws,
      (entry) =>
        entry.type === "error" && entry.message === "Invalid websocket message"
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

  it("surfaces websocket startup errors when terminal init fails", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    harness.ensureSession.mockImplementationOnce(() => {
      throw new Error("Terminal bootstrap failed");
    });
    const app = createTerminalTestApp(harness);
    const hooks = getWebSocketHooks(app, "/api/cells/:id/terminal/ws");
    const ws = createMockWebSocket({
      id: "cell-terminal-ws-fail-1",
      params: { id: TEST_CELL_ID },
    });

    await hooks.open?.(ws.socket);

    assertWebSocketMessage(
      ws,
      (entry) =>
        entry.type === "error" && entry.message === "Terminal bootstrap failed"
    );
    expect(ws.isClosed()).toBeTruthy();
  });
});
// jscpd:ignore-end
