/**
 * Route reachability tests - ensures routes don't shadow each other.
 *
 * These tests verify that each route pattern is reachable and doesn't
 * return 404 due to route ordering issues (e.g., /:id matching before
 * /workspace/:workspaceId/stream).
 *
 * The key distinction:
 * - "Route not matched" = Elysia returns 404 with body "NOT_FOUND"
 * - "Resource not found" = Our handler returns 404 with a meaningful message
 *
 * We test for route matching by checking that we get our handler's response,
 * not Elysia's default "NOT_FOUND".
 */
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { createDeferred, setupTestDb, testDb } from "../test-db";
import {
  createCellRouteTestDependencies,
  DEFAULT_TEST_WORKSPACE_ID,
  decodeEventChunk,
  deleteRouteCellById,
  handleRouteRequest,
  seedRouteCell,
  seedRouteService,
} from "./cells-route-test-helpers";

const TEST_CELL_ID = "test-cell-id";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;

/**
 * Check if a 404 response is from Elysia's "route not found" vs our handler.
 * Elysia returns "NOT_FOUND" as plain text when no route matches.
 */
async function isRouteNotFound(response: Response): Promise<boolean> {
  if (response.status !== HTTP_NOT_FOUND) {
    return false;
  }
  const text = await response.clone().text();
  return text === "NOT_FOUND";
}

async function readSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  const chunk = await reader.read();
  return decodeEventChunk(chunk.value);
}

describe("cells route reachability", () => {
  let app: any;

  beforeAll(async () => {
    await setupTestDb();
    const routes = createCellsRoutes(
      createCellRouteTestDependencies({ cellId: TEST_CELL_ID })
    );
    app = new Elysia().use(routes);
  });

  beforeEach(async () => {
    await testDb.delete(cells);
  });

  const requestFailingServiceAction = async (args: {
    error: unknown;
    path: string;
  }) => {
    const failureApp = new Elysia().use(
      createCellsRoutes(
        createCellRouteTestDependencies({
          cellId: TEST_CELL_ID,
          overrides: {
            startServicesForCell: () => Promise.reject(args.error),
            startServiceById: () => Promise.reject(args.error),
          },
        })
      )
    );
    await seedRouteCell({ id: TEST_CELL_ID, name: "Failing service cell" });
    await seedRouteService({ cellId: TEST_CELL_ID });
    return await handleRouteRequest(failureApp, args.path, { method: "POST" });
  };

  /**
   * Routes that don't require existing resources - should return 200
   */
  it("GET /api/cells/workspace/:id/stream is reachable and returns SSE", async () => {
    const response = await handleRouteRequest(
      app,
      `/api/cells/workspace/${DEFAULT_TEST_WORKSPACE_ID}/stream`
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  /**
   * Routes that require existing resources - should return handler's 404, not Elysia's
   */
  const resourceRoutes: [string, string, string][] = [
    ["GET", `/api/cells/${TEST_CELL_ID}`, "Get cell by ID"],
    ["GET", `/api/cells/${TEST_CELL_ID}/services`, "Get cell services"],
    ["GET", `/api/cells/${TEST_CELL_ID}/activity`, "Get cell activity"],
    ["GET", `/api/cells/${TEST_CELL_ID}/timings`, "Get cell timings"],
    ["GET", `/api/cells/${TEST_CELL_ID}/timings/stream`, "Stream cell timings"],
    [
      "GET",
      `/api/cells/${TEST_CELL_ID}/terminal/stream`,
      "Stream cell terminal",
    ],
    [
      "GET",
      `/api/cells/${TEST_CELL_ID}/chat/terminal/stream`,
      "Stream chat terminal",
    ],
    [
      "GET",
      `/api/cells/${TEST_CELL_ID}/setup/terminal/stream`,
      "Stream setup terminal",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/setup/terminal/resize`,
      "Resize setup terminal",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/setup/terminal/input`,
      "Write setup terminal input",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/terminal/input`,
      "Write terminal input",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/chat/terminal/input`,
      "Write chat terminal input",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/terminal/resize`,
      "Resize terminal session",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/chat/terminal/resize`,
      "Resize chat terminal session",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/terminal/restart`,
      "Restart terminal session",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/chat/terminal/restart`,
      "Restart chat terminal session",
    ],
    [
      "GET",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/terminal/stream`,
      "Stream service terminal",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/terminal/resize`,
      "Resize service terminal",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/terminal/input`,
      "Write service terminal input",
    ],
    ["GET", `/api/cells/${TEST_CELL_ID}/diff`, "Get cell diff"],
    ["DELETE", `/api/cells/${TEST_CELL_ID}`, "Delete cell"],
    ["POST", `/api/cells/${TEST_CELL_ID}/services/restart`, "Restart services"],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/restart`,
      "Restart service",
    ],
    [
      "POST",
      `/api/cells/${TEST_CELL_ID}/setup/retry`,
      "Retry cell provisioning",
    ],
  ];

  for (const [method, path, description] of resourceRoutes) {
    it(`${method} ${path} route is matched (${description})`, async () => {
      const response = await handleRouteRequest(app, path, { method });

      // The route should be matched (not Elysia's default NOT_FOUND)
      // It will return 404 "Cell not found" which is fine - the route was matched
      const routeNotFound = await isRouteNotFound(response);
      expect(
        routeNotFound,
        `Route ${path} was not matched (got Elysia NOT_FOUND)`
      ).toBe(false);
    });
  }

  /**
   * Regression test: /workspace/:id/stream must not be shadowed by /:id
   *
   * This was a real bug where the /:id route was registered before
   * /workspace/:workspaceId/stream, causing "workspace" to be matched as a cell ID.
   */
  it("SSE stream route is not shadowed by /:id route", async () => {
    const response = await handleRouteRequest(
      app,
      `/api/cells/workspace/${DEFAULT_TEST_WORKSPACE_ID}/stream`
    );

    // Should get SSE response, not a "Cell not found" from /:id handler
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("rejects service starts and restarts while a cell is deleting", async () => {
    const startServicesForCell = vi.fn(() => Promise.resolve());
    const startServiceById = vi.fn(() => Promise.resolve());
    const deletingApp = new Elysia().use(
      createCellsRoutes(
        createCellRouteTestDependencies({
          cellId: TEST_CELL_ID,
          overrides: { startServicesForCell, startServiceById },
        })
      )
    );
    await seedRouteCell({
      id: TEST_CELL_ID,
      name: "Deleting cell",
    });
    await testDb
      .update(cells)
      .set({ status: "deleting" })
      .where(eq(cells.id, TEST_CELL_ID));
    await seedRouteService({ cellId: TEST_CELL_ID });

    const bulkResponse = await handleRouteRequest(
      deletingApp,
      `/api/cells/${TEST_CELL_ID}/services/start`,
      { method: "POST" }
    );
    const singleResponse = await handleRouteRequest(
      deletingApp,
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/start`,
      { method: "POST" }
    );

    expect(bulkResponse.status).toBe(HTTP_CONFLICT);
    expect(singleResponse.status).toBe(HTTP_CONFLICT);
    expect(startServicesForCell).not.toHaveBeenCalled();
    expect(startServiceById).not.toHaveBeenCalled();
  });

  it("waits for service starts to complete", async () => {
    const readiness = createDeferred();
    const startInvoked = createDeferred();
    const startServicesForCell = vi.fn(() => {
      startInvoked.resolve();
      return readiness.promise;
    });
    const startingApp = new Elysia().use(
      createCellsRoutes(
        createCellRouteTestDependencies({
          cellId: TEST_CELL_ID,
          overrides: { startServicesForCell },
        })
      )
    );
    await seedRouteCell({ id: TEST_CELL_ID, name: "Starting cell" });
    await seedRouteService({ cellId: TEST_CELL_ID });

    let responseSettled = false;
    const responsePromise = handleRouteRequest(
      startingApp,
      `/api/cells/${TEST_CELL_ID}/services/start`,
      { method: "POST" }
    ).then((routeResponse) => {
      responseSettled = true;
      return routeResponse;
    });

    await startInvoked.promise;
    expect(responseSettled).toBe(false);

    readiness.resolve();
    const response = await responsePromise;

    expect(response.status).toBe(HTTP_OK);
    expect(startServicesForCell).toHaveBeenCalledWith(TEST_CELL_ID);
  });

  it("preserves restart, stop, and start invocation order", async () => {
    const restartStopStarted = createDeferred();
    const releaseRestartStop = createDeferred();
    const operations: string[] = [];
    let stopCalls = 0;
    const stopServicesForCell = vi.fn(async () => {
      stopCalls += 1;
      operations.push("stop");
      if (stopCalls === 1) {
        restartStopStarted.resolve();
        await releaseRestartStop.promise;
      }
    });
    const startServicesForCell = vi.fn(() => {
      operations.push("start");
      return Promise.resolve();
    });
    const actionApp = new Elysia().use(
      createCellsRoutes(
        createCellRouteTestDependencies({
          cellId: TEST_CELL_ID,
          overrides: { startServicesForCell, stopServicesForCell },
        })
      )
    );
    await seedRouteCell({ id: TEST_CELL_ID, name: "Restarting cell" });
    await seedRouteService({ cellId: TEST_CELL_ID });

    const restartResponsePromise = handleRouteRequest(
      actionApp,
      `/api/cells/${TEST_CELL_ID}/services/restart`,
      { method: "POST" }
    );
    await restartStopStarted.promise;

    const stopResponsePromise = handleRouteRequest(
      actionApp,
      `/api/cells/${TEST_CELL_ID}/services/stop`,
      { method: "POST" }
    );
    const startResponsePromise = handleRouteRequest(
      actionApp,
      `/api/cells/${TEST_CELL_ID}/services/start`,
      { method: "POST" }
    );
    await Promise.resolve();
    expect(stopServicesForCell).toHaveBeenCalledOnce();
    expect(startServicesForCell).not.toHaveBeenCalled();

    releaseRestartStop.resolve();
    const [restartResponse, stopResponse, startResponse] = await Promise.all([
      restartResponsePromise,
      stopResponsePromise,
      startResponsePromise,
    ]);

    expect(restartResponse.status).toBe(HTTP_OK);
    expect(stopResponse.status).toBe(HTTP_OK);
    expect(startResponse.status).toBe(HTTP_OK);
    expect(stopServicesForCell).toHaveBeenCalledTimes(2);
    expect(startServicesForCell).toHaveBeenCalledTimes(2);
    expect(operations).toEqual(["stop", "start", "stop", "start"]);
  });

  it.each([
    ["bulk start", `/api/cells/${TEST_CELL_ID}/services/start`],
    ["bulk restart", `/api/cells/${TEST_CELL_ID}/services/restart`],
    [
      "single start",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/start`,
    ],
    [
      "single restart",
      `/api/cells/${TEST_CELL_ID}/services/test-service-id/restart`,
    ],
  ])("reports %s execution failures", async (_description, path) => {
    const executionError = new Error("service execution failed");
    const response = await requestFailingServiceAction({
      error: executionError,
      path,
    });

    expect(response.status).toBe(HTTP_INTERNAL_ERROR);
    expect(await response.json()).toEqual({
      message: "service execution failed",
    });
  });

  it("reports the cause of wrapped supervisor failures", async () => {
    const response = await requestFailingServiceAction({
      error: {
        _tag: "ServiceSupervisorError",
        cause: new Error("readiness check timed out"),
      },
      path: `/api/cells/${TEST_CELL_ID}/services/start`,
    });

    expect(response.status).toBe(HTTP_INTERNAL_ERROR);
    expect(await response.json()).toEqual({
      message: "readiness check timed out",
    });
  });

  it("emits cell_removed when streamed cell is deleted", async () => {
    await seedRouteCell({
      id: TEST_CELL_ID,
      name: "Streaming Cell",
      templateId: "template-basic",
      description: "stream",
      workspacePath: "/tmp/test-workspace-root/.cells/test-cell-id",
      branchName: "cell-test-cell-id",
      baseCommit: "abc123",
    });

    const streamResponse = await handleRouteRequest(
      app,
      `/api/cells/workspace/${DEFAULT_TEST_WORKSPACE_ID}/stream`
    );

    expect(streamResponse.status).toBe(HTTP_OK);
    const reader = streamResponse.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      return;
    }

    await readSseChunk(reader); // ready
    const initialCell = await readSseChunk(reader);
    expect(initialCell).toContain("event: cell");
    expect(initialCell).toContain(TEST_CELL_ID);
    await readSseChunk(reader); // snapshot

    const deleteResponse = await deleteRouteCellById(app, TEST_CELL_ID);
    expect(deleteResponse.status).toBe(HTTP_OK);

    const removalEvent = await readSseChunk(reader);
    expect(removalEvent).toContain("event: cell_removed");
    expect(removalEvent).toContain(TEST_CELL_ID);

    await reader.cancel();
  });
});
