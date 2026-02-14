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
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
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

describe("cells route reachability", () => {
  let app: any;

  beforeAll(async () => {
    await setupTestDb();
    const routes = createCellsRoutes(createMinimalDependencies());
    app = new Elysia().use(routes);
  });

  beforeEach(async () => {
    await testDb.delete(cells);
  });

  /**
   * Routes that don't require existing resources - should return 200
   */
  it("GET /api/cells/workspace/:id/stream is reachable and returns SSE", async () => {
    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/workspace/${TEST_WORKSPACE_ID}/stream`
      )
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
      const response = await app.handle(
        new Request(`http://localhost${path}`, { method })
      );

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
    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/workspace/${TEST_WORKSPACE_ID}/stream`
      )
    );

    // Should get SSE response, not a "Cell not found" from /:id handler
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });
});
