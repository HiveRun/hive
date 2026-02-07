import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import type {
  ServiceTerminalEvent,
  ServiceTerminalSession,
} from "../../services/service-terminal";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
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
): any => {
  const workspaceRecord = {
    id: TEST_WORKSPACE_ID,
    label: "Test Workspace",
    path: "/tmp/test-workspace-root",
    addedAt: new Date().toISOString(),
  };

  return {
    db: testDb,
    resolveWorkspaceContext: (() =>
      Effect.succeed({
        workspace: workspaceRecord,
        loadConfig: () =>
          Effect.succeed({
            opencode: { defaultProvider: "opencode", defaultModel: "mock" },
            promptSources: [],
            templates: {},
            defaults: {},
          }),
        createWorktreeManager: () =>
          Effect.succeed({
            createWorktree: () =>
              Effect.succeed({ path: "/tmp", branch: "b", baseCommit: "c" }),
            removeWorktree: () => Effect.void,
          }),
        createWorktree: () =>
          Effect.succeed({ path: "/tmp", branch: "b", baseCommit: "c" }),
        removeWorktree: () => Effect.void,
      })) as any,
    ensureAgentSession: () =>
      Effect.succeed({ id: "session", cellId: TEST_CELL_ID }),
    closeAgentSession: () => Effect.void,
    ensureServicesForCell: () => Effect.void,
    startServicesForCell: () => Effect.void,
    stopServicesForCell: () => Effect.void,
    startServiceById: () => Effect.void,
    stopServiceById: () => Effect.void,
    sendAgentMessage: () => Effect.void,
    ensureTerminalSession: () => ({
      sessionId: "cell-session",
      cellId: TEST_CELL_ID,
      pid: 123,
      cwd: "/tmp/mock-worktree",
      cols: 120,
      rows: 36,
      status: "running" as const,
      exitCode: null,
      startedAt: new Date().toISOString(),
    }),
    readTerminalOutput: () => "",
    subscribeToTerminal: () => () => 0,
    writeTerminalInput: () => 0,
    resizeTerminal: () => 0,
    closeTerminalSession: () => 0,
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
    clearSetupTerminal: () => 0,
  };
};

const seedData = async () => {
  const now = new Date();
  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Terminal Cell",
    description: null,
    templateId: "template",
    workspacePath: "/tmp/mock-worktree",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-root",
    opencodeSessionId: null,
    createdAt: now,
    status: "ready",
    lastSetupError: null,
    branchName: null,
    baseCommit: null,
    resumeAgentSessionOnStartup: false,
  });

  await testDb.insert(cellServices).values({
    id: TEST_SERVICE_ID,
    cellId: TEST_CELL_ID,
    name: "web",
    type: "process",
    command: "bun run dev",
    cwd: "/tmp/mock-worktree",
    env: {},
    status: "running",
    port: null,
    pid: 222,
    readyTimeoutMs: null,
    definition: {
      type: "process",
      run: "bun run dev",
      cwd: "/tmp/mock-worktree",
      env: {},
    },
    lastKnownError: null,
    createdAt: now,
    updatedAt: now,
  });
};

const decodeChunk = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }
  return "";
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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/setup/terminal/stream`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE reader");
    }

    const readyText = decodeChunk((await reader.read()).value);
    expect(readyText).toContain("event: ready");
    const snapshotText = decodeChunk((await reader.read()).value);
    expect(snapshotText).toContain("event: snapshot");

    harness.emitSetup({ type: "data", chunk: "setup chunk\n" });
    const dataText = decodeChunk((await reader.read()).value);
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("setup chunk");

    await reader.cancel();
  });

  it("streams service terminal readiness, snapshot, and data", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/terminal/stream`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected SSE reader");
    }

    const readyText = decodeChunk((await reader.read()).value);
    expect(readyText).toContain("event: ready");
    const snapshotText = decodeChunk((await reader.read()).value);
    expect(snapshotText).toContain("event: snapshot");

    harness.emitService({ type: "data", chunk: "service chunk\n" });
    const dataText = decodeChunk((await reader.read()).value);
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("service chunk");

    await reader.cancel();
  });

  it("resizes setup terminal session", async () => {
    await seedData();
    const harness = createTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
});
