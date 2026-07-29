import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cellActivityEvents } from "../../schema/activity-events";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import { cellTimingEvents } from "../../schema/timing-events";
import { setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  deleteRouteCellById,
  expectJsonPayload,
  handlePostRouteRequest,
  handleRouteRequest,
  seedRouteCellAndService,
} from "./cells-route-test-helpers";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-cell-id";
const TEST_SERVICE_ID = "service-1";
const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;
const TIMING_CREATE_STEP_OFFSET_MS = 2000;
const TIMING_CREATE_TOTAL_OFFSET_MS = 1800;
const TIMING_CREATE_STEP_DURATION_MS = 1250;
const TIMING_CREATE_TOTAL_DURATION_MS = 1800;
const EXPECTED_CREATE_TIMING_STEP_COUNT = 2;
const EXPECTED_TIMING_RUN_COUNT = 1;

type MinimalDependencyOverrides = {
  closeAgentSession?: (...args: unknown[]) => Promise<void>;
  stopServicesForCell?: (...args: unknown[]) => Promise<void>;
  removeWorktree?: (...args: unknown[]) => Promise<void>;
  runCellTeardown?: (...args: unknown[]) => Promise<void>;
};

function createMinimalDependencies(
  overrides: MinimalDependencyOverrides = {}
): any {
  return createCellRouteTestDependencies({
    cellId: TEST_CELL_ID,
    workspaceId: TEST_WORKSPACE_ID,
    overrides: {
      closeAgentSession: (...args: unknown[]) =>
        overrides.closeAgentSession?.(...args) ?? Promise.resolve(),
      stopServicesForCell: (...args: unknown[]) =>
        overrides.stopServicesForCell?.(...args) ?? Promise.resolve(),
      removeWorktree: (...args: unknown[]) =>
        overrides.removeWorktree?.(...args) ?? Promise.resolve(),
      runCellTeardown: (...args: unknown[]) =>
        overrides.runCellTeardown?.(...args) ?? Promise.resolve(),
    },
  });
}

async function seedCellAndService() {
  await seedRouteCellAndService({
    cell: {
      id: TEST_CELL_ID,
      name: "Test Cell",
      workspaceId: TEST_WORKSPACE_ID,
    },
    service: {
      id: TEST_SERVICE_ID,
      cellId: TEST_CELL_ID,
      name: "server",
      command: "bun run dev",
      status: "running",
      port: 39_993,
    },
  });
}

const createTestApp = (overrides?: MinimalDependencyOverrides) =>
  createCellRouteTestApp(createMinimalDependencies(overrides));

const callServiceAction = (
  app: { handle: (request: Request) => Promise<Response> },
  action: string,
  headers?: HeadersInit
) =>
  handlePostRouteRequest(
    app,
    `/api/cells/${TEST_CELL_ID}/services/${TEST_SERVICE_ID}/${action}`,
    undefined,
    headers ? { headers } : undefined
  );

const readActivityPayload = <TPayload>(
  app: { handle: (request: Request) => Promise<Response> },
  query = ""
) =>
  handleRouteRequest(app, `/api/cells/${TEST_CELL_ID}/activity${query}`).then(
    (response) => expectJsonPayload<TPayload>(response)
  );

describe("Cell activity events", () => {
  beforeAll(setupTestDb);

  beforeEach(async () => {
    await testDb.delete(cellTimingEvents);
    await testDb.delete(cellActivityEvents);
    await testDb.delete(cellServices);
    await testDb.delete(cells);
  });

  it("records service lifecycle events and exposes them via /activity", async () => {
    await seedCellAndService();

    const app = createTestApp();

    const stopResponse = await callServiceAction(app, "stop", {
      "x-hive-source": "opencode",
      "x-hive-tool": "hive_restart_service",
    });

    expect(stopResponse.status).toBe(HTTP_OK);

    const payload = await readActivityPayload<{
      events: Array<{
        type: string;
        serviceId: string | null;
        toolName: string | null;
      }>;
      nextCursor: string | null;
    }>(app);

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

    const app = createTestApp();

    const response = await callServiceAction(app, "restart", {
      "x-hive-source": "opencode",
      "x-hive-tool": "hive_restart_service",
    });

    expect(response.status).toBe(HTTP_OK);

    const body = await readActivityPayload<{
      events: Array<{ type: string; metadata: Record<string, unknown> }>;
    }>(app);

    const restartEvent = body.events.find(
      (event) => event.type === "service.restart"
    );
    expect(restartEvent).toBeDefined();
    expect(restartEvent?.metadata.serviceName).toBe("server");
  });

  it("records log reads only when audit headers are present", async () => {
    await seedCellAndService();

    const app = createTestApp();

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

    const payload = await readActivityPayload<{
      events: Array<{ type: string; serviceId: string | null }>;
    }>(app);

    const serviceLogEvent = payload.events.find(
      (event) => event.type === "service.logs.read"
    );
    expect(serviceLogEvent?.serviceId).toBe(TEST_SERVICE_ID);

    expect(
      payload.events.some((event) => event.type === "setup.logs.read")
    ).toBe(true);
  });

  it("returns grouped create timing steps", async () => {
    await seedCellAndService();

    const createRunId = "create-run-1";
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
    ]);

    const app = createTestApp();

    const response = await handleRouteRequest(
      app,
      `/api/cells/${TEST_CELL_ID}/timings?workflow=create&runId=${createRunId}`
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

    expect(payload.steps).toHaveLength(EXPECTED_CREATE_TIMING_STEP_COUNT);
    expect(payload.steps.every((step) => step.workflow === "create")).toBe(
      true
    );
    expect(payload.steps.every((step) => step.runId === createRunId)).toBe(
      true
    );
    expect(payload.runs).toHaveLength(EXPECTED_TIMING_RUN_COUNT);
    expect(payload.runs[0]?.runId).toBe(createRunId);
    expect(payload.runs[0]?.workflow).toBe("create");
    expect(payload.runs[0]?.status).toBe("ok");
    expect(payload.runs[0]?.totalDurationMs).toBe(
      TIMING_CREATE_TOTAL_DURATION_MS
    );
  });

  it("blocks destructive deletion when service cleanup fails", async () => {
    await seedCellAndService();
    const removeWorktree = vi.fn(() => Promise.resolve());
    const runCellTeardown = vi.fn(() => Promise.resolve());

    const app = createTestApp({
      closeAgentSession: () =>
        Promise.reject(new Error("close session failed")),
      stopServicesForCell: () =>
        Promise.reject(new Error("stop services failed")),
      removeWorktree,
      runCellTeardown,
    });

    const deleteResponse = await deleteRouteCellById(app, TEST_CELL_ID);
    expect(deleteResponse.status).toBe(HTTP_INTERNAL_ERROR);

    const [remainingCell] = await testDb
      .select()
      .from(cells)
      .where(eq(cells.id, TEST_CELL_ID))
      .limit(1);
    expect(remainingCell?.status).toBe("error");
    expect(remainingCell?.lastSetupError).toContain("stop services failed");
    expect(runCellTeardown).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it("paginates activity events with cursors", async () => {
    await seedCellAndService();

    const app = createTestApp();

    await callServiceAction(app, "stop");

    await new Promise((resolve) => setTimeout(resolve, 2));

    await callServiceAction(app, "start");

    const firstPayload = await readActivityPayload<{
      events: Array<{ type: string }>;
      nextCursor: string | null;
    }>(app, "?limit=1");

    expect(firstPayload.events).toHaveLength(1);
    expect(firstPayload.nextCursor).not.toBeNull();

    const secondPayload = await readActivityPayload<{
      events: Array<{ type: string }>;
    }>(
      app,
      `?limit=1&cursor=${encodeURIComponent(firstPayload.nextCursor ?? "")}`
    );

    expect(secondPayload.events).toHaveLength(1);
    expect(secondPayload.events[0]?.type).not.toBe(
      firstPayload.events[0]?.type
    );
  });
});
