import { createServer } from "node:net";

import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import type { ChatTerminalSession } from "../../services/chat-terminal";
import type { ProcessResourceSnapshot } from "../../services/resource-snapshot";
import { setupTestDb, testDb } from "../test-db";

const TEST_WORKSPACE_ID = "test-workspace-services";
const TEST_CELL_ID = "test-cell-services-id";
const TEST_SERVICE_ID = "test-service-id";
const LOG_TAIL_MAX_LINES = 200;
const HTTP_OK = 200;
const SMALL_OUTPUT_LINES = 50;
const LARGE_OUTPUT_LINES = 320;
const EXPECTED_FIRST_TAILED_LINE = 121;
const EXPECTED_CPU_PERCENT = 12.3;
const EXPECTED_RSS_BYTES = 34_560_000;
const EXPECTED_OPENCODE_CPU_PERCENT = 9.5;
const EXPECTED_OPENCODE_RSS_BYTES = 12_000_000;

const getFirstService = <T>(services: T[]): T => {
  const first = services[0];
  if (!first) {
    throw new Error("Expected at least one service in response");
  }
  return first;
};

function createRuntimeHarness() {
  const serviceOutputs = new Map<string, string>();
  const setupOutputByCell = new Map<string, string>();
  const resourcesByPid = new Map<number, ProcessResourceSnapshot>();
  const chatSessionsByCell = new Map<string, ChatTerminalSession>();

  return {
    setServiceOutput(serviceId: string, output: string) {
      serviceOutputs.set(serviceId, output);
    },
    setSetupOutput(cellId: string, output: string) {
      setupOutputByCell.set(cellId, output);
    },
    readServiceOutput(serviceId: string) {
      return serviceOutputs.get(serviceId) ?? "";
    },
    readSetupOutput(cellId: string) {
      return setupOutputByCell.get(cellId) ?? "";
    },
    setResourceSnapshot(pid: number, snapshot: ProcessResourceSnapshot) {
      resourcesByPid.set(pid, snapshot);
    },
    sampleServiceResources(pids: number[]) {
      const snapshots = new Map<number, ProcessResourceSnapshot>();
      for (const pid of pids) {
        const snapshot = resourcesByPid.get(pid);
        if (snapshot) {
          snapshots.set(pid, snapshot);
        }
      }
      return snapshots;
    },
    setChatSession(cellId: string, session: ChatTerminalSession) {
      chatSessionsByCell.set(cellId, session);
    },
    getChatSession(cellId: string) {
      return chatSessionsByCell.get(cellId) ?? null;
    },
  };
}

function createMinimalDependencies(
  harness: ReturnType<typeof createRuntimeHarness>
): any {
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
    getServiceTerminalSession: () => null,
    readServiceTerminalOutput: (serviceId: string) =>
      harness.readServiceOutput(serviceId),
    subscribeToServiceTerminal: () => () => 0,
    writeServiceTerminalInput: () => 0,
    resizeServiceTerminal: () => 0,
    clearServiceTerminal: () => 0,
    getSetupTerminalSession: () => null,
    readSetupTerminalOutput: (cellId: string) =>
      harness.readSetupOutput(cellId),
    subscribeToSetupTerminal: () => () => 0,
    writeSetupTerminalInput: () => 0,
    resizeSetupTerminal: () => 0,
    clearSetupTerminal: () => 0,
    getChatTerminalSession: (cellId: string) => harness.getChatSession(cellId),
    sampleServiceResources: (pids: number[]) =>
      Promise.resolve(harness.sampleServiceResources(pids)),
  };
}

async function insertCellAndServiceRecords(
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
) {
  const now = new Date();

  await testDb.insert(cells).values({
    id: TEST_CELL_ID,
    name: "Test Cell Services",
    description: "Test cell for services payload validation",
    templateId: "test-template",
    workspaceId: TEST_WORKSPACE_ID,
    workspaceRootPath: "/tmp/test-workspace-services-root",
    workspacePath: "/tmp/test-workspace-services-root",
    branchName: "test-branch",
    baseCommit: "test-commit",
    opencodeSessionId: null,
    createdAt: now,
    status: "ready",
    lastSetupError: null,
  });

  await testDb.insert(cellServices).values({
    id: TEST_SERVICE_ID,
    cellId: TEST_CELL_ID,
    name: serviceName,
    type: "process",
    command: "echo test",
    cwd: "/tmp/test-workspace-services-root",
    env: { TEST_VAR: "test" },
    status: options?.status ?? "running",
    port: options?.port ?? null,
    pid: options?.pid ?? null,
    readyTimeoutMs: null,
    definition: {
      type: "process",
      run: "echo test",
      cwd: "/tmp/test-workspace-services-root",
      env: {},
    },
    lastKnownError: null,
    createdAt: now,
    updatedAt: now,
  });
}

function buildLogLines(serviceName: string, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const line = index + 1;
    return `Log line ${line}: runtime output for ${serviceName}`;
  }).join("\n");
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

      if (
        code === "EADDRNOTAVAIL" ||
        code === "EAFNOSUPPORT" ||
        code === "EPROTONOSUPPORT"
      ) {
        resolve({ port: null, close });
        return;
      }

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

describe("GET /api/cells/:id/services payload", () => {
  let app: any;
  let harness: ReturnType<typeof createRuntimeHarness>;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cellServices);
    await testDb.delete(cells);
    harness = createRuntimeHarness();
    app = new Elysia().use(
      createCellsRoutes(createMinimalDependencies(harness))
    );
  });

  it("returns null logPath and runtime-backed recentLogs", async () => {
    const serviceName = "web";
    await insertCellAndServiceRecords(serviceName);
    harness.setServiceOutput(
      TEST_SERVICE_ID,
      buildLogLines(serviceName, SMALL_OUTPUT_LINES)
    );

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{ logPath: string | null; recentLogs: string | null }>;
    };

    const service = getFirstService(body.services);
    expect(service.logPath).toBeNull();
    expect(service.recentLogs?.split("\n").length).toBe(SMALL_OUTPUT_LINES);
  });

  it("caps runtime recentLogs to 200 lines", async () => {
    const serviceName = "api";
    await insertCellAndServiceRecords(serviceName);
    harness.setServiceOutput(
      TEST_SERVICE_ID,
      buildLogLines(serviceName, LARGE_OUTPUT_LINES)
    );

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{ recentLogs: string | null }>;
    };

    const service = getFirstService(body.services);
    const lines = service.recentLogs?.split("\n") ?? [];
    expect(lines.length).toBe(LOG_TAIL_MAX_LINES);
    expect(lines[0]).toBe(
      `Log line ${EXPECTED_FIRST_TAILED_LINE}: runtime output for ${serviceName}`
    );
    expect(lines.at(-1)).toBe(
      `Log line ${LARGE_OUTPUT_LINES}: runtime output for ${serviceName}`
    );
  });

  it("returns null recentLogs when runtime output is empty", async () => {
    const serviceName = "empty";
    await insertCellAndServiceRecords(serviceName);
    harness.setServiceOutput(TEST_SERVICE_ID, "");

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{ recentLogs: string | null }>;
    };

    const service = getFirstService(body.services);
    expect(service.recentLogs).toBeNull();
  });

  it("reports portReachable true for services bound to ::1", async () => {
    const listener = await createIpv6LoopbackListener();
    if (!listener.port) {
      return;
    }

    await insertCellAndServiceRecords("server", {
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

    const service = getFirstService(body.services);
    expect(service.port).toBe(listener.port);
    expect(service.portReachable).toBe(true);

    await listener.close();
  });

  it("returns resource snapshots when includeResources=true", async () => {
    const livePid = process.pid;
    await insertCellAndServiceRecords("metrics", {
      status: "running",
      pid: livePid,
    });
    harness.setResourceSnapshot(livePid, {
      cpuPercent: EXPECTED_CPU_PERCENT,
      rssBytes: EXPECTED_RSS_BYTES,
      resourceSampledAt: new Date().toISOString(),
    });

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services?includeResources=true`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{
        cpuPercent?: number | null;
        rssBytes?: number | null;
        resourceSampledAt?: string;
      }>;
    };

    const service = getFirstService(body.services);
    expect(service.cpuPercent).toBe(EXPECTED_CPU_PERCENT);
    expect(service.rssBytes).toBe(EXPECTED_RSS_BYTES);
    expect(service.resourceSampledAt).toBeDefined();
  });

  it("omits resource fields when includeResources=false", async () => {
    await insertCellAndServiceRecords("metrics-disabled", {
      status: "running",
      pid: process.pid,
    });

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${TEST_CELL_ID}/services`)
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{ cpuPercent?: number | null; rssBytes?: number | null }>;
    };

    const service = getFirstService(body.services);
    expect(service.cpuPercent).toBeUndefined();
    expect(service.rssBytes).toBeUndefined();
  });

  it("returns process_not_alive when service pid is stale", async () => {
    await insertCellAndServiceRecords("stale-process", {
      status: "running",
      pid: 999_999,
    });

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/services?includeResources=true`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      services: Array<{
        cpuPercent?: number | null;
        rssBytes?: number | null;
        resourceUnavailableReason?: string;
      }>;
    };

    const service = getFirstService(body.services);
    expect(service.cpuPercent).toBeNull();
    expect(service.rssBytes).toBeNull();
    expect(service.resourceUnavailableReason).toBe("process_not_alive");
  });

  it("returns aggregated resources including opencode session", async () => {
    await insertCellAndServiceRecords("service-for-aggregate", {
      status: "running",
      pid: 999_999,
    });

    harness.setChatSession(TEST_CELL_ID, {
      sessionId: "chat-session",
      cellId: TEST_CELL_ID,
      pid: process.pid,
      cwd: "/tmp/test-workspace-services-root",
      cols: 120,
      rows: 36,
      status: "running",
      exitCode: null,
      startedAt: new Date().toISOString(),
    });

    harness.setResourceSnapshot(process.pid, {
      cpuPercent: EXPECTED_OPENCODE_CPU_PERCENT,
      rssBytes: EXPECTED_OPENCODE_RSS_BYTES,
      resourceSampledAt: new Date().toISOString(),
    });

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${TEST_CELL_ID}/resources?includeHistory=true&historyLimit=10`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const body = (await response.json()) as {
      tracked: {
        services: number;
        opencode: number;
      };
      activeProcessCount: number;
      activeCpuPercent: number;
      activeRssBytes: number;
      processes: Array<{ kind: string }>;
      history?: Array<{
        sampledAt: string;
        activeCpuPercent: number;
        processes: Array<{ kind: string }>;
      }>;
    };

    expect(body.tracked.services).toBe(1);
    expect(body.tracked.opencode).toBe(1);
    expect(body.activeProcessCount).toBe(1);
    expect(body.activeCpuPercent).toBe(EXPECTED_OPENCODE_CPU_PERCENT);
    expect(body.activeRssBytes).toBe(EXPECTED_OPENCODE_RSS_BYTES);
    expect(body.processes.some((process) => process.kind === "opencode")).toBe(
      true
    );
    expect((body.history ?? []).length).toBeGreaterThan(0);
    expect(body.history?.some((point) => point.processes.length > 0)).toBe(
      true
    );
  });
});
