import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cellActivityEvents } from "../../schema/activity-events";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace";
const TEST_CELL_ID = "test-cell-id";
const TEST_SERVICE_ID = "service-1";
const HTTP_OK = 200;

function createMinimalDependencies(): any {
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
    opencodeServerUrl: null,
    opencodeServerPort: null,
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
