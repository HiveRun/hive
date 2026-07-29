import { createServer } from "node:net";

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cellServicePorts, cellServices } from "../../schema/services";
import type { ChatTerminalSession } from "../../services/chat-terminal";
import type { ProcessResourceSnapshot } from "../../services/resource-snapshot";
import type { ServiceTerminalSession } from "../../services/service-terminal";
import { setupTestDb, testDb } from "../test-db";
import {
  clearRouteServicesAndCells,
  createCellRouteTestApp,
  createCellRouteTestDependencies,
  expectJsonPayload,
  handleRouteRequest,
  seedRouteCellAndService,
} from "./cells-route-test-helpers";

const TEST_WORKSPACE_ID = "test-workspace-services";
const TEST_CELL_ID = "test-cell-services-id";
const TEST_SERVICE_ID = "test-service-id";
const LOG_TAIL_MAX_LINES = 200;
const SMALL_OUTPUT_LINES = 50;
const LARGE_OUTPUT_LINES = 320;
const EXPECTED_FIRST_TAILED_LINE = 121;
const EXPECTED_CPU_PERCENT = 12.3;
const EXPECTED_RSS_BYTES = 34_560_000;

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
  const setupSessionsByCell = new Map<string, ServiceTerminalSession>();

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
    setSetupSession(cellId: string, session: ServiceTerminalSession) {
      setupSessionsByCell.set(cellId, session);
    },
    getSetupSession(cellId: string) {
      return setupSessionsByCell.get(cellId) ?? null;
    },
  };
}

function createMinimalDependencies(
  harness: ReturnType<typeof createRuntimeHarness>
): any {
  return createCellRouteTestDependencies({
    cellId: TEST_CELL_ID,
    workspaceId: TEST_WORKSPACE_ID,
    workspacePath: "/tmp/test-workspace-services-root",
    workspaceRootPath: "/tmp/test-workspace-services-root",
    overrides: {
      readServiceTerminalOutput: (serviceId: string) =>
        harness.readServiceOutput(serviceId),
      getSetupTerminalSession: (cellId: string) =>
        harness.getSetupSession(cellId),
      readSetupTerminalOutput: (cellId: string) =>
        harness.readSetupOutput(cellId),
      getChatTerminalSession: (cellId: string) =>
        harness.getChatSession(cellId),
      sampleServiceResources: (pids: number[]) =>
        Promise.resolve(harness.sampleServiceResources(pids)),
    },
  });
}

const readServicesPayload = <TPayload>(
  app: { handle: (request: Request) => Promise<Response> },
  query = ""
) =>
  handleRouteRequest(app, `/api/cells/${TEST_CELL_ID}/services${query}`).then(
    (response) => expectJsonPayload<TPayload>(response)
  );

const readFirstServicePayload = async <TService>(
  app: { handle: (request: Request) => Promise<Response> },
  query = ""
) => {
  const body = await readServicesPayload<{ services: TService[] }>(app, query);
  return getFirstService(body.services);
};

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
  await seedRouteCellAndService({
    cell: {
      id: TEST_CELL_ID,
      name: "Test Cell Services",
      description: "Test cell for services payload validation",
      templateId: "test-template",
      workspaceId: TEST_WORKSPACE_ID,
      workspaceRootPath: "/tmp/test-workspace-services-root",
      workspacePath: "/tmp/test-workspace-services-root",
      branchName: "test-branch",
      baseCommit: "test-commit",
    },
    service: {
      id: TEST_SERVICE_ID,
      cellId: TEST_CELL_ID,
      name: serviceName,
      command: "echo test",
      cwd: "/tmp/test-workspace-services-root",
      env: { TEST_VAR: "test" },
      definitionEnv: {},
      status: options?.status ?? "running",
      port: options?.port ?? null,
      pid: options?.pid ?? null,
    },
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

  beforeAll(setupTestDb);

  beforeEach(async () => {
    await clearRouteServicesAndCells();
    harness = createRuntimeHarness();
    app = createCellRouteTestApp(createMinimalDependencies(harness));
  });

  it("returns null logPath and runtime-backed recentLogs", async () => {
    const serviceName = "web";
    await insertCellAndServiceRecords(serviceName);
    harness.setServiceOutput(
      TEST_SERVICE_ID,
      buildLogLines(serviceName, SMALL_OUTPUT_LINES)
    );

    const service = await readFirstServicePayload<{
      logPath: string | null;
      recentLogs: string | null;
    }>(app);
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

    const service = await readFirstServicePayload<{
      recentLogs: string | null;
    }>(app);
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

    const service = await readFirstServicePayload<{
      recentLogs: string | null;
    }>(app);
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

    const service = await readFirstServicePayload<{
      portReachable?: boolean;
      port?: number;
    }>(app);
    expect(service.port).toBe(listener.port);
    expect(service.portReachable).toBe(true);

    await listener.close();
  });

  it("returns normalized ports while retaining the primary scalar aliases", async () => {
    const primaryPort = 43_101;
    const metricsPort = 43_102;
    const securePort = 43_103;
    await insertCellAndServiceRecords("server", { port: primaryPort });
    await testDb
      .update(cellServices)
      .set({
        definition: {
          type: "process",
          run: "echo test",
          ports: {
            http: { primary: true },
            metrics: { protocol: "tcp" },
            secure: { protocol: "https" },
          },
        },
      })
      .where(eq(cellServices.id, TEST_SERVICE_ID));
    const now = new Date();
    await testDb.insert(cellServicePorts).values([
      {
        serviceId: TEST_SERVICE_ID,
        name: "http",
        port: primaryPort,
        primary: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        serviceId: TEST_SERVICE_ID,
        name: "metrics",
        port: metricsPort,
        primary: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        serviceId: TEST_SERVICE_ID,
        name: "secure",
        port: securePort,
        primary: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const service = await readFirstServicePayload<{
      port: number;
      url: string;
      ports: Array<{
        name: string;
        port: number;
        primary: boolean;
        protocol: "http" | "https" | "tcp";
        url?: string;
        portReachable: boolean;
      }>;
    }>(app);
    expect(service.port).toBe(primaryPort);
    expect(service.url).toContain(String(primaryPort));
    expect(service.ports).toEqual([
      {
        name: "http",
        port: primaryPort,
        primary: true,
        protocol: "http",
        url: `http://localhost:${primaryPort}`,
        portReachable: false,
      },
      {
        name: "metrics",
        port: metricsPort,
        primary: false,
        protocol: "tcp",
        portReachable: false,
      },
      {
        name: "secure",
        port: securePort,
        primary: false,
        protocol: "https",
        url: `https://localhost:${securePort}`,
        portReachable: false,
      },
    ]);
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

    const service = await readFirstServicePayload<{
      cpuPercent?: number | null;
      rssBytes?: number | null;
      resourceSampledAt?: string;
    }>(app, "?includeResources=true");
    expect(service.cpuPercent).toBe(EXPECTED_CPU_PERCENT);
    expect(service.rssBytes).toBe(EXPECTED_RSS_BYTES);
    expect(service.resourceSampledAt).toBeDefined();
  });

  it("omits resource fields when includeResources=false", async () => {
    await insertCellAndServiceRecords("metrics-disabled", {
      status: "running",
      pid: process.pid,
    });

    const service = await readFirstServicePayload<{
      cpuPercent?: number | null;
      rssBytes?: number | null;
    }>(app);
    expect(service.cpuPercent).toBeUndefined();
    expect(service.rssBytes).toBeUndefined();
  });

  it("returns process_not_alive when service pid is stale", async () => {
    await insertCellAndServiceRecords("stale-process", {
      status: "running",
      pid: 999_999,
    });

    const service = await readFirstServicePayload<{
      cpuPercent?: number | null;
      rssBytes?: number | null;
      resourceUnavailableReason?: string;
    }>(app, "?includeResources=true");
    expect(service.cpuPercent).toBeNull();
    expect(service.rssBytes).toBeNull();
    expect(service.resourceUnavailableReason).toBe("process_not_alive");
  });
});
