import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ServiceTerminalEvent,
  ServiceTerminalSession,
} from "../../services/service-terminal";
import { setupTestDb } from "../test-db";
import {
  clearRouteServicesAndCells,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  createRouteServiceTerminalSession,
  exerciseBasicTerminalWebSocket,
  expectLiveDataEvent,
  expectReadyAndSnapshotEvents,
  expectResizePayload,
  handlePostRouteRequest,
  openMockWebSocket,
  openRouteEventStream,
  seedRouteCell,
  seedRouteService,
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

  let setupSession: ServiceTerminalSession | null =
    createRouteServiceTerminalSession({ sessionId: "setup-session", pid: 111 });

  let serviceSession: ServiceTerminalSession | null =
    createRouteServiceTerminalSession({
      sessionId: "service-session",
      pid: 222,
    });

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

const openTerminalStream = async (app: any, path: string) =>
  openRouteEventStream(app, path);

const terminalPath = (kind: "setup" | "service", action: string) =>
  kind === "setup"
    ? `/api/cells/${TEST_CELL_ID}/setup/terminal/${action}`
    : `/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/terminal/${action}`;

const createSeededTerminalContext = async () => {
  await seedData();
  const harness = createTerminalHarness();
  return { harness, app: createTerminalTestApp(harness) };
};

const postTerminalAction = async (
  kind: "setup" | "service",
  action: "resize" | "input",
  body: Record<string, unknown>
) => {
  const { harness, app } = await createSeededTerminalContext();
  const response = await handlePostRouteRequest(
    app,
    terminalPath(kind, action),
    body
  );
  return { harness, response };
};

const openTerminalWebSocket = async (kind: "setup" | "service") => {
  const { harness, app } = await createSeededTerminalContext();
  const socketArgs =
    kind === "setup"
      ? {
          path: "/api/cells/:id/setup/terminal/ws",
          id: "setup-terminal-ws-1",
          params: { id: TEST_CELL_ID },
        }
      : {
          path: "/api/cells/:id/services/:serviceId/terminal/ws",
          id: "service-terminal-ws-1",
          params: { id: TEST_CELL_ID, serviceId: TEST_SERVICE_ID },
        };
  const socket = await openMockWebSocket({ app, ...socketArgs });
  return { harness, ...socket };
};

const expectTerminalStream = async (
  kind: "setup" | "service",
  event: { chunk: string; expectedText: string }
) => {
  const { harness, app } = await createSeededTerminalContext();
  const reader = await openTerminalStream(app, terminalPath(kind, "stream"));

  await expectReadyAndSnapshotEvents(reader);
  await expectLiveDataEvent({
    reader,
    emit: () =>
      kind === "setup"
        ? harness.emitSetup({ type: "data", chunk: event.chunk })
        : harness.emitService({ type: "data", chunk: event.chunk }),
    expectedText: event.expectedText,
  });
  await reader.cancel();
};

const expectTerminalWebSocket = async (kind: "setup" | "service") => {
  const { harness, hooks, ws } = await openTerminalWebSocket(kind);
  await exerciseBasicTerminalWebSocket({
    hooks,
    ws,
    input: kind === "setup" ? SETUP_INPUT : SERVICE_INPUT,
    cols: kind === "setup" ? SETUP_RESIZE_COLS : SERVICE_RESIZE_COLS,
    rows: kind === "setup" ? SETUP_RESIZE_ROWS : SERVICE_RESIZE_ROWS,
    readInputs:
      kind === "setup" ? harness.getSetupInputs : harness.getServiceInputs,
  });
};

describe("service/setup terminal routes", () => {
  beforeAll(setupTestDb);

  beforeEach(clearRouteServicesAndCells);

  it("streams setup terminal readiness, snapshot, and data", async () => {
    await expectTerminalStream("setup", {
      chunk: "setup chunk\n",
      expectedText: "setup chunk",
    });
  });

  it("streams service terminal readiness, snapshot, and data", async () => {
    await expectTerminalStream("service", {
      chunk: "service chunk\n",
      expectedText: "service chunk",
    });
  });

  it("resizes setup terminal session", async () => {
    const { response } = await postTerminalAction("setup", "resize", {
      cols: SETUP_RESIZE_COLS,
      rows: SETUP_RESIZE_ROWS,
    });

    expect(response.status).toBe(HTTP_OK);
    await expectResizePayload(response, SETUP_RESIZE_COLS, SETUP_RESIZE_ROWS);
  });

  it("writes setup terminal input", async () => {
    const { harness, response } = await postTerminalAction("setup", "input", {
      data: SETUP_INPUT,
    });

    expect(response.status).toBe(HTTP_OK);
    expect(harness.getSetupInputs()).toEqual([SETUP_INPUT]);
  });

  it("resizes service terminal session", async () => {
    const { response } = await postTerminalAction("service", "resize", {
      cols: SERVICE_RESIZE_COLS,
      rows: SERVICE_RESIZE_ROWS,
    });

    expect(response.status).toBe(HTTP_OK);
    await expectResizePayload(
      response,
      SERVICE_RESIZE_COLS,
      SERVICE_RESIZE_ROWS
    );
  });

  it("writes service terminal input", async () => {
    const { harness, response } = await postTerminalAction("service", "input", {
      data: SERVICE_INPUT,
    });

    expect(response.status).toBe(HTTP_OK);
    expect(harness.getServiceInputs()).toEqual([SERVICE_INPUT]);
  });

  it("handles setup terminal websocket messages", async () => {
    await expectTerminalWebSocket("setup");
  });

  it("handles service terminal websocket messages", async () => {
    await expectTerminalWebSocket("service");
  });
});
