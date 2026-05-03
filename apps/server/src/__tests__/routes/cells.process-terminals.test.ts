// jscpd:ignore-start
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import type {
  ServiceTerminalEvent,
  ServiceTerminalSession,
} from "../../services/service-terminal";
import { setupTestDb, testDb } from "../test-db";
import {
  assertWebSocketType,
  closeWebSocketNormally,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createEventStreamReader,
  createMockWebSocket,
  getWebSocketHooks,
  seedRouteCell,
  seedRouteService,
  sendWebSocketJson,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const TEST_SERVICE_ID = "test-service-id";
const HTTP_OK = 200;
const SETUP_RESIZE_COLS = 150;
const SETUP_RESIZE_ROWS = 40;
const SERVICE_RESIZE_COLS = 132;
const SERVICE_RESIZE_ROWS = 44;
const SETUP_INPUT = "echo setup\n";
const SERVICE_INPUT = "echo service\n";

const createTerminalHarness = () => {
  const setupListeners = new Set<(event: ServiceTerminalEvent) => void>();
  const serviceListeners = new Set<(event: ServiceTerminalEvent) => void>();

  let setupSession: ServiceTerminalSession | null = {
    sessionId: "setup-session",
    pid: 111,
    cwd: "/tmp/mock-worktree",
    cols: 120,
    rows: 36,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
  };

  let serviceSession: ServiceTerminalSession | null = {
    sessionId: "service-session",
    pid: 222,
    cwd: "/tmp/mock-worktree",
    cols: 120,
    rows: 36,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
  };

  let setupOutput = "setup snapshot\n";
  let serviceOutput = "service snapshot\n";
  const setupInputs: string[] = [];
  const serviceInputs: string[] = [];

  return {
    getSetupSession: () => setupSession,
    readSetupOutput: () => setupOutput,
    subscribeSetup: (listener: (event: ServiceTerminalEvent) => void) => {
      setupListeners.add(listener);
      return () => {
        setupListeners.delete(listener);
      };
    },
    resizeSetup: (cols: number, rows: number) => {
      if (!setupSession) {
        throw new Error("setup session unavailable");
      }
      setupSession = { ...setupSession, cols, rows };
    },
    writeSetup: (data: string) => {
      setupInputs.push(data);
    },
    emitSetup: (event: ServiceTerminalEvent) => {
      for (const listener of setupListeners) {
        listener(event);
      }
    },

    getServiceSession: () => serviceSession,
    readServiceOutput: () => serviceOutput,
    subscribeService: (listener: (event: ServiceTerminalEvent) => void) => {
      serviceListeners.add(listener);
      return () => {
        serviceListeners.delete(listener);
      };
    },
    resizeService: (cols: number, rows: number) => {
      if (!serviceSession) {
        throw new Error("service session unavailable");
      }
      serviceSession = { ...serviceSession, cols, rows };
    },
    writeService: (data: string) => {
      serviceInputs.push(data);
    },
    emitService: (event: ServiceTerminalEvent) => {
      for (const listener of serviceListeners) {
        listener(event);
      }
    },

    setSetupOutput(value: string) {
      setupOutput = value;
    },
    setServiceOutput(value: string) {
      serviceOutput = value;
    },
    getSetupInputs() {
      return [...setupInputs];
    },
    getServiceInputs() {
      return [...serviceInputs];
    },
  };
};

const createDependencies = (
  harness: ReturnType<typeof createTerminalHarness>
): any =>
  createCellRouteTestDependencies({
    cellId: TEST_CELL_ID,
    overrides: {
      getServiceTerminalSession: () => harness.getServiceSession(),
      readServiceTerminalOutput: () => harness.readServiceOutput(),
      subscribeToServiceTerminal: (
        _serviceId: string,
        listener: (event: ServiceTerminalEvent) => void
      ) => harness.subscribeService(listener),
      writeServiceTerminalInput: (_serviceId: string, data: string) =>
        harness.writeService(data),
      resizeServiceTerminal: (_serviceId: string, cols: number, rows: number) =>
        harness.resizeService(cols, rows),
      clearServiceTerminal: () => 0,
      getSetupTerminalSession: () => harness.getSetupSession(),
      readSetupTerminalOutput: () => harness.readSetupOutput(),
      subscribeToSetupTerminal: (
        _cellId: string,
        listener: (event: ServiceTerminalEvent) => void
      ) => harness.subscribeSetup(listener),
      writeSetupTerminalInput: (_cellId: string, data: string) =>
        harness.writeSetup(data),
      resizeSetupTerminal: (_cellId: string, cols: number, rows: number) =>
        harness.resizeSetup(cols, rows),
    },
  });

const createTerminalTestApp = (
  harness: ReturnType<typeof createTerminalHarness>
) => createCellRouteTestApp(createDependencies(harness));

const seedData = async () => {
  await seedRouteCell({ id: TEST_CELL_ID, name: "Terminal Cell" });
  await seedRouteService({
    id: TEST_SERVICE_ID,
    cellId: TEST_CELL_ID,
    name: "web",
    command: "bun run dev",
    cwd: "/tmp/mock-worktree",
    status: "running",
    pid: 222,
  });
};

const openTerminalStream = async (app: any, path: string) => {
  const response = await app.handle(new Request(`http://localhost${path}`));
  if (response.status !== HTTP_OK) {
    throw new Error(`Expected status ${HTTP_OK}, got ${response.status}`);
  }
  return createEventStreamReader(response);
};

describe("service/setup terminal routes", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cellServices);
    await testDb.delete(cells);
  });

  it("streams setup terminal readiness, snapshot, and data", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);
    const reader = await openTerminalStream(
      app,
      `/api/cells/${TEST_CELL_ID}/setup/terminal/stream`
    );

    const readyText = await reader.read();
    expect(readyText).toContain("event: ready");
    const snapshotText = await reader.read();
    expect(snapshotText).toContain("event: snapshot");

    harness.emitSetup({ type: "data", chunk: "setup chunk\n" });
    const dataText = await reader.read();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("setup chunk");

    await reader.cancel();
  });

  it("streams service terminal readiness, snapshot, and data", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);
    const reader = await openTerminalStream(
      app,
      `/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/terminal/stream`
    );

    const readyText = await reader.read();
    expect(readyText).toContain("event: ready");
    const snapshotText = await reader.read();
    expect(snapshotText).toContain("event: snapshot");

    harness.emitService({ type: "data", chunk: "service chunk\n" });
    const dataText = await reader.read();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("service chunk");

    await reader.cancel();
  });

  it("resizes setup terminal session", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/setup/terminal/resize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cols: SETUP_RESIZE_COLS,
            rows: SETUP_RESIZE_ROWS,
          }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      ok: boolean;
      session: { cols: number; rows: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.session.cols).toBe(SETUP_RESIZE_COLS);
    expect(payload.session.rows).toBe(SETUP_RESIZE_ROWS);
  });

  it("writes setup terminal input", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/setup/terminal/input`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: SETUP_INPUT }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.getSetupInputs()).toEqual([SETUP_INPUT]);
  });

  it("resizes service terminal session", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/terminal/resize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cols: SERVICE_RESIZE_COLS,
            rows: SERVICE_RESIZE_ROWS,
          }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      ok: boolean;
      session: { cols: number; rows: number };
    };
    expect(payload.ok).toBe(true);
    expect(payload.session.cols).toBe(SERVICE_RESIZE_COLS);
    expect(payload.session.rows).toBe(SERVICE_RESIZE_ROWS);
  });

  it("writes service terminal input", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/terminal/input`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: SERVICE_INPUT }),
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(harness.getServiceInputs()).toEqual([SERVICE_INPUT]);
  });

  it("handles setup terminal websocket messages", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);
    const hooks = getWebSocketHooks(app, "/api/cells/:id/setup/terminal/ws");
    const ws = createMockWebSocket({
      id: "setup-terminal-ws-1",
      params: { id: TEST_CELL_ID },
    });

    await hooks.open?.(ws.socket);
    assertWebSocketType(ws, "ready");

    sendWebSocketJson(hooks, ws.socket, { type: "input", data: SETUP_INPUT });
    expect(harness.getSetupInputs()).toEqual([SETUP_INPUT]);

    sendWebSocketJson(hooks, ws.socket, {
      type: "resize",
      cols: SETUP_RESIZE_COLS,
      rows: SETUP_RESIZE_ROWS,
    });
    assertWebSocketType(ws, "ready");

    sendWebSocketJson(hooks, ws.socket, { type: "ping" });
    assertWebSocketType(ws, "pong");

    closeWebSocketNormally(hooks, ws.socket);
    expect(ws.isClosed()).toBeFalsy();
  });

  it("handles service terminal websocket messages", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = createTerminalTestApp(harness);
    const hooks = getWebSocketHooks(
      app,
      "/api/cells/:id/services/:serviceId/terminal/ws"
    );
    const ws = createMockWebSocket({
      id: "service-terminal-ws-1",
      params: { id: TEST_CELL_ID, serviceId: TEST_SERVICE_ID },
    });

    await hooks.open?.(ws.socket);
    assertWebSocketType(ws, "ready");

    sendWebSocketJson(hooks, ws.socket, { type: "input", data: SERVICE_INPUT });
    expect(harness.getServiceInputs()).toEqual([SERVICE_INPUT]);

    sendWebSocketJson(hooks, ws.socket, {
      type: "resize",
      cols: SERVICE_RESIZE_COLS,
      rows: SERVICE_RESIZE_ROWS,
    });
    assertWebSocketType(ws, "ready");

    sendWebSocketJson(hooks, ws.socket, { type: "ping" });
    assertWebSocketType(ws, "pong");

    closeWebSocketNormally(hooks, ws.socket);
    expect(ws.isClosed()).toBeFalsy();
  });
});
// jscpd:ignore-end
