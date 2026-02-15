import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cellActivityEvents } from "../../schema/activity-events";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import { cellTimingEvents } from "../../schema/timing-events";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-cell-id";
const TEST_SERVICE_ID = "service-1";
const HTTP_OK = 200;
const TIMING_CREATE_STEP_OFFSET_MS = 2000;
const TIMING_CREATE_TOTAL_OFFSET_MS = 1800;
const TIMING_DELETE_STEP_OFFSET_MS = 1000;
const TIMING_DELETE_TOTAL_OFFSET_MS = 900;
const TIMING_CREATE_STEP_DURATION_MS = 1250;
const TIMING_CREATE_TOTAL_DURATION_MS = 1800;
const TIMING_DELETE_STEP_DURATION_MS = 30;
const TIMING_DELETE_TOTAL_DURATION_MS = 55;
const EXPECTED_DELETE_TIMING_STEP_COUNT = 2;
const EXPECTED_TIMING_RUN_COUNT = 1;

type MinimalDependencyOverrides = {
  closeAgentSession?: (...args: unknown[]) => Promise<void>;
  stopServicesForCell?: (...args: unknown[]) => Promise<void>;
  removeWorktree?: (...args: unknown[]) => Promise<void>;
};

function createMinimalDependencies(
  overrides: MinimalDependencyOverrides = {}
): any {
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
        removeWorktree: (...args: unknown[]) =>
          overrides.removeWorktree?.(...args) ?? Promise.resolve(),
      }),
      createWorktree: async () => ({
        path: "/tmp",
        branch: "b",
        baseCommit: "c",
      }),
      removeWorktree: (...args: unknown[]) =>
        overrides.removeWorktree?.(...args) ?? Promise.resolve(),
    })) as any,
    ensureAgentSession: async () => ({ id: "session", cellId: TEST_CELL_ID }),
    closeAgentSession: (...args: unknown[]) =>
      overrides.closeAgentSession?.(...args) ?? Promise.resolve(),
    ensureServicesForCell: () => Promise.resolve(),
    startServicesForCell: () => Promise.resolve(),
    stopServicesForCell: (...args: unknown[]) =>
      overrides.stopServicesForCell?.(...args) ?? Promise.resolve(),
    startServiceById: () => Promise.resolve(),
    stopServiceById: () => Promise.resolve(),
    sendAgentMessage: () => Promise.resolve(),
    ensureTerminalSession: () => ({
      sessionId: "terminal-session",
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

async function seedCellAndService() {
  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Test Cell",
    description: null,
    templateId: "template",
    workspacePath: "/tmp/mock-worktree",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-root",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "ready",
    lastSetupError: null,
    branchName: null,
    baseCommit: null,
    resumeAgentSessionOnStartup: false,
  });

  await testDb.insert(cellServices).values({
    id: TEST_SERVICE_ID,
    cellId: TEST_CELL_ID,
    name: "server",
    type: "process",
    command: "bun run dev",
    cwd: "/tmp/mock-worktree",
    env: {},
    status: "running",
    port: 39_993,
    pid: null,
    readyTimeoutMs: null,
    definition: {
      type: "process",
      cwd: "/tmp/mock-worktree",
      env: {},
      run: "bun run dev",
    },
    lastKnownError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("Cell activity events", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cellTimingEvents);
    await testDb.delete(cellActivityEvents);
    await testDb.delete(cellServices);
    await testDb.delete(cells);
  });

  it("records service lifecycle events and exposes them via /activity", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    const stopResponse = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/stop`,
        {
          method: "POST",
          headers: {
            "x-hive-source": "opencode",
            "x-hive-tool": "hive_restart_service",
          },
        }
      )
    );

    expect(stopResponse.status).toBe(HTTP_OK);

    const activityResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/activity`)
    );
    expect(activityResponse.status).toBe(HTTP_OK);
    const payload = (await activityResponse.json()) as {
      events: Array<{
        type: string;
        serviceId: string | null;
        toolName: string | null;
      }>;
      nextCursor: string | null;
    };

    expect(payload.nextCursor).toBeNull();
    expect(payload.events.some((event) => event.type === "service.stop")).toBe(
      true
    );

    const stopEvent = payload.events.find(
      (event) => event.type === "service.stop"
    );
    expect(stopEvent?.serviceId).toBe(TEST_SERVICE_ID);
    expect(stopEvent?.toolName).toBe("hive_restart_service");
  });

  it("records restart events", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/restart`,
        {
          method: "POST",
          headers: {
            "x-hive-source": "opencode",
            "x-hive-tool": "hive_restart_service",
          },
        }
      )
    );

    expect(response.status).toBe(HTTP_OK);

    const activityResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/activity`)
    );
    expect(activityResponse.status).toBe(HTTP_OK);
    const body = (await activityResponse.json()) as {
      events: Array<{ type: string; metadata: Record<string, unknown> }>;
    };

    const restartEvent = body.events.find(
      (event) => event.type === "service.restart"
    );
    expect(restartEvent).toBeDefined();
    expect(restartEvent?.metadata.serviceName).toBe("server");
  });

  it("records log reads only when audit headers are present", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    const servicesResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`, {
        headers: {
          "x-hive-source": "opencode",
          "x-hive-tool": "hive_service_logs",
          "x-hive-audit-event": "service.logs.read",
          "x-hive-service-name": "server",
        },
      })
    );
    expect(servicesResponse.status).toBe(HTTP_OK);

    const cellResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}`, {
        headers: {
          "x-hive-source": "opencode",
          "x-hive-tool": "hive_setup_logs",
          "x-hive-audit-event": "setup.logs.read",
        },
      })
    );
    expect(cellResponse.status).toBe(HTTP_OK);

    const activityResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/activity`)
    );
    expect(activityResponse.status).toBe(HTTP_OK);
    const payload = (await activityResponse.json()) as {
      events: Array<{ type: string; serviceId: string | null }>;
    };

    const serviceLogEvent = payload.events.find(
      (event) => event.type === "service.logs.read"
    );
    expect(serviceLogEvent?.serviceId).toBe(TEST_SERVICE_ID);

    expect(
      payload.events.some((event) => event.type === "setup.logs.read")
    ).toBe(true);
  });

  it("returns grouped timing steps for creation and deletion", async () => {
    await seedCellAndService();

    const createRunId = "create-run-1";
    const deleteRunId = "delete-run-1";
    const now = Date.now();

    await testDb.insert(cellTimingEvents).values([
      {
        id: "timing-create-step",
        cellId: TEST_CELL_ID,
        cellName: "Test Cell",
        workspaceId: TEST_WORKSPACE_ID,
        templateId: "template",
        workflow: "create",
        runId: createRunId,
        step: "ensure_services",
        status: "ok",
        durationMs: TIMING_CREATE_STEP_DURATION_MS,
        attempt: 1,
        error: null,
        metadata: {
          workflow: "create",
          runId: createRunId,
          step: "ensure_services",
          status: "ok",
          durationMs: TIMING_CREATE_STEP_DURATION_MS,
          attempt: 1,
        },
        createdAt: new Date(now - TIMING_CREATE_STEP_OFFSET_MS),
      },
      {
        id: "timing-create-total",
        cellId: TEST_CELL_ID,
        cellName: "Test Cell",
        workspaceId: TEST_WORKSPACE_ID,
        templateId: "template",
        workflow: "create",
        runId: createRunId,
        step: "total",
        status: "ok",
        durationMs: TIMING_CREATE_TOTAL_DURATION_MS,
        attempt: 1,
        error: null,
        metadata: {
          workflow: "create",
          runId: createRunId,
          step: "total",
          status: "ok",
          durationMs: TIMING_CREATE_TOTAL_DURATION_MS,
          attempt: 1,
        },
        createdAt: new Date(now - TIMING_CREATE_TOTAL_OFFSET_MS),
      },
      {
        id: "timing-delete-step",
        cellId: TEST_CELL_ID,
        cellName: "Test Cell",
        workspaceId: TEST_WORKSPACE_ID,
        templateId: "template",
        workflow: "delete",
        runId: deleteRunId,
        step: "stop_services",
        status: "error",
        durationMs: TIMING_DELETE_STEP_DURATION_MS,
        attempt: null,
        error: "mock failure",
        metadata: {
          workflow: "delete",
          runId: deleteRunId,
          step: "stop_services",
          status: "error",
          durationMs: TIMING_DELETE_STEP_DURATION_MS,
          error: "mock failure",
        },
        createdAt: new Date(now - TIMING_DELETE_STEP_OFFSET_MS),
      },
      {
        id: "timing-delete-total",
        cellId: TEST_CELL_ID,
        cellName: "Test Cell",
        workspaceId: TEST_WORKSPACE_ID,
        templateId: "template",
        workflow: "delete",
        runId: deleteRunId,
        step: "total",
        status: "error",
        durationMs: TIMING_DELETE_TOTAL_DURATION_MS,
        attempt: null,
        error: "mock failure",
        metadata: {
          workflow: "delete",
          runId: deleteRunId,
          step: "total",
          status: "error",
          durationMs: TIMING_DELETE_TOTAL_DURATION_MS,
          error: "mock failure",
        },
        createdAt: new Date(now - TIMING_DELETE_TOTAL_OFFSET_MS),
      },
    ]);

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/timings?workflow=delete&runId=${deleteRunId}`
      )
    );
    expect(response.status).toBe(HTTP_OK);

    const payload = (await response.json()) as {
      steps: Array<{
        workflow: string;
        runId: string;
        step: string;
        status: string;
      }>;
      runs: Array<{
        runId: string;
        workflow: string;
        status: string;
        totalDurationMs: number;
      }>;
    };

    expect(payload.steps).toHaveLength(EXPECTED_DELETE_TIMING_STEP_COUNT);
    expect(payload.steps.every((step) => step.workflow === "delete")).toBe(
      true
    );
    expect(payload.steps.every((step) => step.runId === deleteRunId)).toBe(
      true
    );
    expect(payload.runs).toHaveLength(EXPECTED_TIMING_RUN_COUNT);
    expect(payload.runs[0]?.runId).toBe(deleteRunId);
    expect(payload.runs[0]?.workflow).toBe("delete");
    expect(payload.runs[0]?.status).toBe("error");
    expect(payload.runs[0]?.totalDurationMs).toBe(
      TIMING_DELETE_TOTAL_DURATION_MS
    );
  });

  it("keeps deletion timings queryable globally after cell removal", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    const deleteResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}`, {
        method: "DELETE",
      })
    );
    expect(deleteResponse.status).toBe(HTTP_OK);

    const timingsResponse = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/timings?workflow=delete`
      )
    );
    expect(timingsResponse.status).toBe(HTTP_OK);

    const payload = (await timingsResponse.json()) as {
      steps: Array<{ step: string; workflow: string }>;
      runs: Array<{ workflow: string }>;
    };

    expect(payload.steps.some((step) => step.step === "total")).toBe(true);
    expect(payload.steps.every((step) => step.workflow === "delete")).toBe(
      true
    );
    expect(payload.runs.every((run) => run.workflow === "delete")).toBe(true);

    const globalResponse = await app.handle(
      new Request(
        `http://localhost/api/cells/timings/global?workflow=delete&cellId=${TEST_CELL_ID}`
      )
    );
    expect(globalResponse.status).toBe(HTTP_OK);

    const globalPayload = (await globalResponse.json()) as {
      steps: Array<{ cellId: string; workflow: string; step: string }>;
      runs: Array<{ cellId: string; workflow: string }>;
    };

    expect(globalPayload.steps.length).toBeGreaterThan(0);
    expect(
      globalPayload.steps.every((step) => step.cellId === TEST_CELL_ID)
    ).toBe(true);
    expect(
      globalPayload.steps.every((step) => step.workflow === "delete")
    ).toBe(true);
    expect(globalPayload.runs.every((run) => run.cellId === TEST_CELL_ID)).toBe(
      true
    );
  });

  it("continues cell deletion when cleanup steps fail", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(
      createMinimalDependencies({
        closeAgentSession: () =>
          Promise.reject(new Error("close session failed")),
        stopServicesForCell: () =>
          Promise.reject(new Error("stop services failed")),
        removeWorktree: () =>
          Promise.reject(new Error("remove workspace failed")),
      })
    );
    const app = new Elysia().use(routes);

    const deleteResponse = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}`, {
        method: "DELETE",
      })
    );
    expect(deleteResponse.status).toBe(HTTP_OK);

    const remainingCell = await testDb
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.id, TEST_CELL_ID))
      .limit(1);
    expect(remainingCell).toHaveLength(0);

    const timingsResponse = await app.handle(
      new Request(
        `http://localhost/api/cells/timings/global?workflow=delete&cellId=${TEST_CELL_ID}`
      )
    );
    expect(timingsResponse.status).toBe(HTTP_OK);

    const timingsPayload = (await timingsResponse.json()) as {
      steps: Array<{
        step: string;
        status: "ok" | "error";
        error: string | null;
      }>;
      runs: Array<{
        status: "ok" | "error";
      }>;
    };

    const closeAgentStep = timingsPayload.steps.find(
      (step) => step.step === "close_agent_session"
    );
    const stopServicesStep = timingsPayload.steps.find(
      (step) => step.step === "stop_services"
    );
    const removeWorkspaceStep = timingsPayload.steps.find(
      (step) => step.step === "remove_workspace"
    );
    const deleteRecordStep = timingsPayload.steps.find(
      (step) => step.step === "delete_cell_record"
    );
    const totalStep = timingsPayload.steps.find(
      (step) => step.step === "total"
    );

    expect(closeAgentStep?.status).toBe("error");
    expect(closeAgentStep?.error).toBe("close session failed");
    expect(stopServicesStep?.status).toBe("error");
    expect(stopServicesStep?.error).toBe("stop services failed");
    expect(removeWorkspaceStep).toBeDefined();
    expect(deleteRecordStep?.status).toBe("ok");
    expect(totalStep?.status).toBe("ok");
    expect(timingsPayload.runs[0]?.status).toBe("error");
  });

  it("paginates activity events with cursors", async () => {
    await seedCellAndService();

    const routes = createCellsRoutes(createMinimalDependencies());
    const app = new Elysia().use(routes);

    await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/stop`,
        { method: "POST" }
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 2));

    await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/start`,
        { method: "POST" }
      )
    );

    const firstPage = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/activity?limit=1`)
    );
    expect(firstPage.status).toBe(HTTP_OK);
    const firstPayload = (await firstPage.json()) as {
      events: Array<{ type: string }>;
      nextCursor: string | null;
    };

    expect(firstPayload.events).toHaveLength(1);
    expect(firstPayload.nextCursor).not.toBeNull();

    const secondPage = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/activity?limit=1&cursor=${encodeURIComponent(
          firstPayload.nextCursor ?? ""
        )}`
      )
    );
    expect(secondPage.status).toBe(HTTP_OK);
    const secondPayload = (await secondPage.json()) as {
      events: Array<{ type: string }>;
    };

    expect(secondPayload.events).toHaveLength(1);
    expect(secondPayload.events[0]?.type).not.toBe(
      firstPayload.events[0]?.type
    );
  });
});
