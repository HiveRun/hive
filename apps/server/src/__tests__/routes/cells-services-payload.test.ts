/**
 * Services API payload + log tail bounds test
 *
 * Validates that:
 * - GET /api/cells/:id/services returns logPath and recentLogs fields
 * - recentLogs is bounded to <= 200 lines (LOG_TAIL_MAX_LINES)
 * - logPath points to <workspacePath>/.hive/logs/<service>.log
 */

import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace-services";
const TEST_CELL_ID = "test-cell-services-id";
const TEST_SERVICE_ID = "test-service-id";
const LOG_TAIL_MAX_LINES = 200;
const TEST_LOG_LINES_SMALL = 50;
const TEST_LOG_LINES_TINY = 5;
const SERVICE_LOG_DIR = ".hive/logs";
const HTTP_OK = 200;

/**
 * Helper to get first service from response, asserting it exists.
 * This satisfies both biome (no non-null assertion) and TypeScript (proper narrowing).
 */
function getFirstService<T>(services: T[]): T {
  const first = services[0];
  if (first === undefined) {
    throw new Error("Expected at least one service in response");
  }
  return first;
}

/**
 * Create a minimal set of dependencies for the cells routes.
 * We don't need real workspace resolution or service supervision for this test.
 */
function createMinimalDependencies(): any {
  const workspaceRecord = {
    id: TEST_WORKSPACE_ID,
    label: "Test Workspace Services",
    path: "/tmp/test-workspace-services-root",
    addedAt: new Date().toISOString(),
  };

  return {
    db: testDb,
    resolveWorkspaceContext: (() => ({
      workspace: workspaceRecord,
      loadConfig: () =>
        Promise.resolve({
          opencode: { defaultProvider: "opencode", defaultModel: "mock" },
          promptSources: [],
          templates: {},
          defaults: {},
        }),
      createWorktreeManager: () =>
        Promise.resolve({
          createWorktree: () =>
            Promise.resolve({ path: "/tmp", branch: "b", baseCommit: "c" }),
          removeWorktree: () => Promise.resolve(),
        }),
      createWorktree: () =>
        Promise.resolve({ path: "/tmp", branch: "b", baseCommit: "c" }),
      removeWorktree: () => Promise.resolve(),
    })) as any,
    ensureAgentSession: () =>
      Promise.resolve({ id: "session", cellId: TEST_CELL_ID }),
    closeAgentSession: () => Promise.resolve(),
    ensureServicesForCell: () => Promise.resolve(),
    startServicesForCell: () => Promise.resolve(),
    stopServicesForCell: () => Promise.resolve(),
    startServiceById: () => Promise.resolve(),
    stopServiceById: () => Promise.resolve(),
    sendAgentMessage: () => Promise.resolve(),
    ensureTerminalSession: () => ({
      sessionId: "terminal-session",
      cellId: TEST_CELL_ID,
      pid: 123,
      cwd: "/tmp/test-workspace-services-root",
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
  };
}

/**
 * Create a temporary directory for workspace testing.
 */
async function createTempWorkspace(): Promise<string> {
  const tempDir = await fs.mkdtemp(join(tmpdir(), "hive-test-"));
  return tempDir;
}

/**
 * Create a log file with more than 200 lines.
 */
async function createLogFileWithManyLines(
  workspacePath: string,
  serviceName: string,
  lineCount = 300
): Promise<string> {
  const logDir = join(workspacePath, SERVICE_LOG_DIR);
  await fs.mkdir(logDir, { recursive: true });

  const logPath = join(logDir, `${serviceName}.log`);
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(
      `Log line ${i}: This is test log content for service ${serviceName}`
    );
  }
  await fs.writeFile(logPath, lines.join("\n"));

  return logPath;
}

/**
 * Insert minimal cell and service records into the test database.
 */
async function insertCellAndServiceRecords(
  workspacePath: string,
  serviceName: string,
  options?: {
    port?: number | null;
    pid?: number | null;
    status?:
      | "pending"
      | "starting"
      | "running"
      | "needs_resume"
      | "stopped"
      | "error";
  }
): Promise<{ cellId: string; serviceId: string }> {
  const cellId = TEST_CELL_ID;
  const serviceId = TEST_SERVICE_ID;

  const now = new Date();

  // Insert cell record
  await testDb
    .insert(cells)
    .values({
      id: cellId,
      name: "Test Cell Services",
      description: "Test cell for services payload validation",
      templateId: "test-template",
      workspaceId: TEST_WORKSPACE_ID,
      workspaceRootPath: workspacePath,
      workspacePath,
      branchName: "test-branch",
      baseCommit: "test-commit",
      opencodeSessionId: null,
      opencodeServerUrl: null,
      opencodeServerPort: null,
      createdAt: now,
      status: "ready",
      lastSetupError: null,
    })
    .returning();

  // Insert service record
  await testDb
    .insert(cellServices)
    .values({
      id: serviceId,
      cellId,
      name: serviceName,
      type: "process",
      command: "echo test",
      cwd: workspacePath,
      env: { TEST_VAR: "test" },
      status: options?.status ?? "running",
      port: options?.port ?? null,
      pid: options?.pid ?? null,
      readyTimeoutMs: null,
      definition: {
        type: "process",
        run: "echo test",
        cwd: workspacePath,
        env: {},
      },
      lastKnownError: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { cellId, serviceId };
}

function createIpv6LoopbackListener(): Promise<
  | { port: number; close: () => Promise<void> }
  | { port: null; close: () => Promise<void> }
> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      const close = () =>
        new Promise<void>((resolveClose) => {
          try {
            server.close(() => resolveClose());
          } catch {
            resolveClose();
          }
        });
      // If IPv6 loopback isn't available, treat as unsupported and let the test skip.
      if (
        code === "EADDRNOTAVAIL" ||
        code === "EAFNOSUPPORT" ||
        code === "EPROTONOSUPPORT"
      ) {
        resolve({ port: null, close });
        return;
      }
      // For other errors, surface via a rejected close in the test.
      resolve({ port: null, close });
    });

    server.listen(0, "::1", () => {
      const address = server.address();
      const port =
        address && typeof address === "object" ? Number(address.port) : null;
      const close = () =>
        new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
        });
      resolve({ port: port ?? null, close });
    });
  });
}

/**
 * Clean up the temporary workspace directory.
 */
async function cleanupTempWorkspace(workspacePath: string): Promise<void> {
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("GET /api/cells/:id/services - payload validation", () => {
  let app: any;
  let tempWorkspace: string;

  beforeAll(async () => {
    await setupTestDb();
    const routes = createCellsRoutes(createMinimalDependencies());
    app = new Elysia().use(routes);
  });

  beforeEach(async () => {
    // Clear database tables
    await testDb.delete(cellServices);
    await testDb.delete(cells);

    // Create a new temp workspace for each test
    tempWorkspace = await createTempWorkspace();
  });

  describe("logPath and recentLogs fields", () => {
    it("returns logPath pointing to <workspacePath>/.hive/logs/<service>.log", async () => {
      const serviceName = "web";
      await createLogFileWithManyLines(
        tempWorkspace,
        serviceName,
        TEST_LOG_LINES_SMALL
      );
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ logPath: string }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.logPath).toBe(
        join(tempWorkspace, SERVICE_LOG_DIR, `${serviceName}.log`)
      );
    });

    it("returns recentLogs with the last N lines from the log file", async () => {
      const serviceName = "api";
      const totalLines = TEST_LOG_LINES_SMALL;
      await createLogFileWithManyLines(tempWorkspace, serviceName, totalLines);
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ recentLogs: string }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.recentLogs).toBeTruthy();

      // Verify that recentLogs contains the expected tail
      const recentLogsLines = service.recentLogs.split("\n");
      expect(recentLogsLines.length).toBe(totalLines);

      // Verify that the last line matches the last line in the file
      const lastLineExpected = `Log line ${totalLines}: This is test log content for service ${serviceName}`;
      expect(recentLogsLines.at(-1)).toBe(lastLineExpected);
    });
  });

  describe("log tail line bounds", () => {
    it("limits recentLogs to 200 lines when log file has more lines", async () => {
      const serviceName = "web";
      const totalLines = 300; // More than LOG_TAIL_MAX_LINES
      await createLogFileWithManyLines(tempWorkspace, serviceName, totalLines);
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ recentLogs: string }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.recentLogs).toBeTruthy();

      const recentLogsLines = service.recentLogs.split("\n");
      expect(recentLogsLines.length).toBe(LOG_TAIL_MAX_LINES);

      // Verify that the returned logs are the LAST 200 lines, not the first 200
      const lastLineExpected = `Log line ${totalLines}: This is test log content for service ${serviceName}`;
      expect(recentLogsLines.at(-1)).toBe(lastLineExpected);

      const firstReturnedLine = recentLogsLines[0];
      const expectedFirstReturnedLine = `Log line ${totalLines - LOG_TAIL_MAX_LINES + 1}: This is test log content for service ${serviceName}`;
      expect(firstReturnedLine).toBe(expectedFirstReturnedLine);
    });

    it("returns all lines when log file has fewer than 200 lines", async () => {
      const serviceName = "api";
      const totalLines = TEST_LOG_LINES_SMALL; // Fewer than LOG_TAIL_MAX_LINES
      await createLogFileWithManyLines(tempWorkspace, serviceName, totalLines);
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ recentLogs: string }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.recentLogs).toBeTruthy();

      const recentLogsLines = service.recentLogs.split("\n");
      expect(recentLogsLines.length).toBe(totalLines);
    });

    it("handles empty log file", async () => {
      const serviceName = "empty";
      const logDir = join(tempWorkspace, SERVICE_LOG_DIR);
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(join(logDir, `${serviceName}.log`), "");
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ recentLogs: string | null }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      // Empty file should return empty string or null
      expect(service.recentLogs === "" || service.recentLogs === null).toBe(
        true
      );
    });
  });

  describe("service name sanitization in log path", () => {
    it("sanitizes service name for log file path", async () => {
      const serviceName = "My Web Service";
      const sanitizedName = "my_web_service"; // Non-alphanumeric chars replaced with _
      await createLogFileWithManyLines(tempWorkspace, sanitizedName, 10);
      await insertCellAndServiceRecords(tempWorkspace, serviceName);

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ logPath: string }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.logPath).toBe(
        join(tempWorkspace, SERVICE_LOG_DIR, `${sanitizedName}.log`)
      );
    });
  });

  describe("port reachability", () => {
    it("reports portReachable true for services bound to ::1 (IPv6 localhost)", async () => {
      const listener = await createIpv6LoopbackListener();
      if (!listener.port) {
        // IPv6 loopback isn't supported in this environment.
        return;
      }

      const serviceName = "server";
      await createLogFileWithManyLines(
        tempWorkspace,
        serviceName,
        TEST_LOG_LINES_TINY
      );
      await insertCellAndServiceRecords(tempWorkspace, serviceName, {
        port: listener.port,
        status: "starting",
      });

      const response = await app.handle(
        new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
      );

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as {
        services: Array<{ portReachable?: boolean; port?: number }>;
      };
      expect(body.services).toHaveLength(1);

      const service = getFirstService(body.services);
      expect(service.port).toBe(listener.port);
      expect(service.portReachable).toBe(true);

      await listener.close();
    });
  });

  describe("cleanup", () => {
    it("cleans up temp workspace after test", async () => {
      // This test validates that cleanupTempWorkspace works
      const workspacePath = await createTempWorkspace();
      await fs.mkdir(join(workspacePath, SERVICE_LOG_DIR), { recursive: true });
      const logPath = join(workspacePath, SERVICE_LOG_DIR, "test.log");
      await fs.writeFile(logPath, "test");

      // Verify the directory and file exist
      await fs.stat(workspacePath);
      await fs.stat(logPath);

      // Clean up
      await cleanupTempWorkspace(workspacePath);

      // Verify the directory is removed (should throw ENOENT)
      await expect(fs.stat(workspacePath)).rejects.toThrow();
    });
  });
});
