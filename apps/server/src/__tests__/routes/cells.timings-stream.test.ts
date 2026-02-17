import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { emitCellTimingUpdate } from "../../services/events";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function createMinimalDependencies(): any {
  const workspaceRecord = {
    id: TEST_WORKSPACE_ID,
    label: "Test Workspace",
    path: "/tmp/test-workspace-root",
    addedAt: new Date().toISOString(),
  };

  return {
    db: testDb,
    resolveWorkspaceContext: (async () => ({
      workspace: workspaceRecord,
      loadConfig: async () => ({
        opencode: { defaultProvider: "opencode", defaultModel: "mock" },
        promptSources: [],
        templates: {},
        defaults: {},
      }),
      createWorktreeManager: async () => ({
        createWorktree: async () => ({
          path: "/tmp",
          branch: "b",
          baseCommit: "c",
        }),
        removeWorktree: async () => Promise.resolve(),
      }),
      createWorktree: async () => ({
        path: "/tmp",
        branch: "b",
        baseCommit: "c",
      }),
      removeWorktree: async () => Promise.resolve(),
    })) as any,
    ensureAgentSession: async () => ({ id: "session", cellId: TEST_CELL_ID }),
    closeAgentSession: async () => Promise.resolve(),
    ensureServicesForCell: async () => Promise.resolve(),
    startServiceById: async () => Promise.resolve(),
    startServicesForCell: async () => Promise.resolve(),
    stopServiceById: async () => Promise.resolve(),
    stopServicesForCell: async () => Promise.resolve(),
    sendAgentMessage: async () => Promise.resolve(),
    ensureTerminalSession: () => ({
      sessionId: "terminal-session",
      cellId: TEST_CELL_ID,
      pid: 123,
      cwd: "/tmp/test-workspace-root",
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
    getServiceTerminalSession: () => null,
    readServiceTerminalOutput: () => "",
    subscribeToServiceTerminal: () => () => 0,
    writeServiceTerminalInput: () => 0,
    resizeServiceTerminal: () => 0,
    clearServiceTerminal: () => 0,
    getSetupTerminalSession: () => null,
    readSetupTerminalOutput: () => "",
    subscribeToSetupTerminal: () => () => 0,
    writeSetupTerminalInput: () => 0,
    resizeSetupTerminal: () => 0,
    clearSetupTerminal: () => 0,
  };
}

async function seedCell() {
  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Timing Cell",
    description: null,
    templateId: "template",
    workspacePath: "/tmp/mock-worktree",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-root",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "spawning",
    lastSetupError: null,
    branchName: null,
    baseCommit: null,
    resumeAgentSessionOnStartup: false,
  });
}

function decodeChunk(value: unknown): string {
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
}

describe("Cell timings stream route", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("streams timing events after ready/snapshot", async () => {
    await seedCell();
    const app = new Elysia().use(
      createCellsRoutes(createMinimalDependencies())
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/timings/stream?workflow=create`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected SSE reader");
    }

    const readyText = decodeChunk((await reader.read()).value);
    expect(readyText).toContain("event: ready");

    const snapshotText = decodeChunk((await reader.read()).value);
    expect(snapshotText).toContain("event: snapshot");

    emitCellTimingUpdate({
      cellId: TEST_CELL_ID,
      workflow: "create",
      runId: "run-1",
      step: "create_worktree",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    const timingText = decodeChunk((await reader.read()).value);
    expect(timingText).toContain("event: timing");
    expect(timingText).toContain('"workflow":"create"');
    expect(timingText).toContain('"step":"create_worktree"');
  });

  it("filters timing events by workflow", async () => {
    await seedCell();
    const app = new Elysia().use(
      createCellsRoutes(createMinimalDependencies())
    );

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/timings/stream?workflow=create`
      )
    );

    expect(response.status).toBe(HTTP_OK);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected SSE reader");
    }

    await reader.read(); // ready
    await reader.read(); // snapshot

    emitCellTimingUpdate({
      cellId: TEST_CELL_ID,
      workflow: "delete",
      runId: "run-delete",
      step: "remove_workspace",
      status: "ok",
      createdAt: new Date().toISOString(),
    });
    emitCellTimingUpdate({
      cellId: TEST_CELL_ID,
      workflow: "create",
      runId: "run-create",
      step: "mark_ready",
      status: "ok",
      createdAt: new Date().toISOString(),
    });

    const timingText = decodeChunk((await reader.read()).value);
    expect(timingText).toContain("event: timing");
    expect(timingText).toContain('"workflow":"create"');
    expect(timingText).not.toContain('"workflow":"delete"');
  });

  it("returns 404 when the cell does not exist", async () => {
    const app = new Elysia().use(
      createCellsRoutes(createMinimalDependencies())
    );

    const response = await app.handle(
      new Request("http://localhost/api/cells/missing/timings/stream")
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });
});
