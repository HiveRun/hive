import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import type {
  CellTerminalEvent,
  CellTerminalSession,
} from "../../services/terminal";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const RESIZED_COLS = 140;
const RESIZED_ROWS = 48;
const FIRST_CALL_INDEX = 0;

function createTerminalHarness() {
  const listeners = new Set<(event: CellTerminalEvent) => void>();
  let sequence = 0;
  let session: CellTerminalSession = {
    sessionId: "terminal-0",
    cellId: TEST_CELL_ID,
    pid: 4567,
    cwd: "/tmp/mock-worktree",
    cols: 120,
    rows: 36,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
  };

  const ensureSession = vi.fn(
    ({ cellId, workspacePath }: { cellId: string; workspacePath: string }) => {
      sequence += 1;
      session = {
        ...session,
        sessionId: `terminal-${sequence}`,
        cellId,
        cwd: workspacePath,
        status: "running",
        exitCode: null,
      };
      return session;
    }
  );

  const readOutput = vi.fn(() => "snapshot> ready\n");
  const subscribe = vi.fn(
    (
      _cellId: string,
      listener: (event: CellTerminalEvent) => void
    ): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  );
  const write = vi.fn((_cellId: string, _data: string) => 0);
  const resize = vi.fn((_cellId: string, cols: number, rows: number) => {
    session = {
      ...session,
      cols,
      rows,
    };
    return 0;
  });
  const closeSession = vi.fn((_cellId: string) => 0);

  return {
    ensureSession,
    readOutput,
    subscribe,
    write,
    resize,
    closeSession,
    emit(event: CellTerminalEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

function createDependencies(
  harness: ReturnType<typeof createTerminalHarness>
): any {
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
    ensureTerminalSession: harness.ensureSession,
    readTerminalOutput: harness.readOutput,
    subscribeToTerminal: harness.subscribe,
    writeTerminalInput: harness.write,
    resizeTerminal: harness.resize,
    closeTerminalSession: harness.closeSession,
    getServiceTerminalSession: () => null,
    readServiceTerminalOutput: () => "",
    subscribeToServiceTerminal: () => () => 0,
    resizeServiceTerminal: () => 0,
    clearServiceTerminal: () => 0,
    getSetupTerminalSession: () => null,
    readSetupTerminalOutput: () => "",
    subscribeToSetupTerminal: () => () => 0,
    resizeSetupTerminal: () => 0,
    clearSetupTerminal: () => 0,
  };
}

async function seedCell() {
  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Terminal Cell",
    description: null,
    templateId: "template",
    workspacePath: "/tmp/mock-worktree",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-root",
    opencodeSessionId: null,
    opencodeServerUrl: null,
    opencodeServerPort: null,
    createdAt: new Date(),
    status: "ready",
    lastSetupError: null,
    branchName: null,
    baseCommit: null,
    resumeAgentSessionOnStartup: false,
  });
}

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/terminal/stream`)
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Response body reader unavailable");
    }

    const decoder = new TextDecoder();
    const decodeChunk = (value: unknown): string => {
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Uint8Array) {
        return decoder.decode(value);
      }
      if (value instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(value));
      }
      return "";
    };

    const readTextChunk = async () => {
      const chunk = await reader.read();
      return decodeChunk(chunk.value);
    };

    const firstChunk = await reader.read();
    const firstText = decodeChunk(firstChunk.value);
    expect(firstText).toContain("event: ready");
    const snapshotText = await readTextChunk();
    expect(snapshotText).toContain("event: snapshot");

    harness.emit({ type: "data", chunk: "echo hi\n" });
    const dataText = await readTextChunk();
    expect(dataText).toContain("event: data");
    expect(dataText).toContain("echo hi");

    await reader.cancel();
  });

  it("forwards terminal input to the terminal service", async () => {
    await seedCell();
    const harness = createTerminalHarness();
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
    const app = new Elysia().use(
      createCellsRoutes(createDependencies(harness))
    );

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
});
