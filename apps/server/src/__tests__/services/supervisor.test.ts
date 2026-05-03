import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../../config/context";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import { createServiceTerminalRuntime } from "../../services/service-terminal";
import type {
  ProcessHandle,
  RunCommand,
  SpawnProcess,
  SpawnProcessOptions,
} from "../../services/supervisor";
import { createServiceSupervisor } from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const silentLogger = {
  info() {
    /* noop logger for tests */
  },
  warn() {
    /* noop logger for tests */
  },
  error() {
    /* noop logger for tests */
  },
};

type FakeProcess = {
  options: SpawnProcessOptions;
  handle: ProcessHandle;
  exit: (code: number) => void;
};

describe("service supervisor", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  let workspaceDirs: string[] = [];

  beforeEach(async () => {
    await testDb.delete(cellServices);
    await testDb.delete(cells);
    workspaceDirs = [];
  });

  afterEach(async () => {
    for (const dir of workspaceDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts process services with assigned ports and env", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-web");

    const harness = createHarness();

    await ensureProcessServices({
      harness,
      cell,
      templateId: "template-web",
      services: {
        web: serviceDefinition({ env: { NODE_ENV: "test" } }),
      },
    });

    expect(harness.processes).toHaveLength(1);
    const call = firstProcess(harness, "Expected process to be recorded");
    expect(call.options.cwd).toBe(workspace);
    expect(call.options.env.NODE_ENV).toBe("test");
    expect(call.options.env.WEB_PORT).toBeDefined();
    expect(call.options.env.PORT).toBe(call.options.env.WEB_PORT);

    const [service] = await testDb.select().from(cellServices);
    expect(service?.status).toBe("running");
    expect(typeof service?.port).toBe("number");

    await stopCellHarness(harness, cell.id);
  });

  it("captures runtime output in service terminal buffers", async () => {
    const { cell, harness } = await createStartedHarness("template-web");

    const service = await getOnlyService(cell.id);

    const output = harness.terminalRuntime.readServiceOutput(service.id);
    expect(output).toContain("bun run dev");
  });

  it("does not start duplicate services when pid is alive", async () => {
    const { cell, harness } = await createStartedHarness("template-dup", {
      server: serviceDefinition(),
    });

    const service = await getOnlyService(cell.id);

    if (!service?.pid) {
      throw new Error("Expected service pid to be set");
    }

    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && pid === service.pid) {
        return true as never;
      }
      throw new Error("unexpected kill");
    }) as unknown as typeof process.kill;

    await ensureProcessServices({
      harness,
      cell,
      templateId: "template-dup",
      services: {
        server: serviceDefinition(),
      },
    });

    process.kill = originalKill;

    expect(harness.processes).toHaveLength(1);
  });

  it("does not start duplicate services on concurrent start", async () => {
    const { cell, harness } = await createStartedHarness("template-concurrent");

    const service = await getOnlyService(cell.id);

    await harness.supervisor.stopCellService(service.id);

    const startingCount = harness.processes.length;

    await Promise.all([
      harness.supervisor.startCellService(service.id),
      harness.supervisor.startCellService(service.id),
    ]);

    expect(harness.processes).toHaveLength(startingCount + 1);

    await stopCellHarness(harness, cell.id);
  });

  it("runs template setup commands before starting services", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-setup");

    const harness = createHarness();

    await ensureProcessServices({
      harness,
      cell,
      templateId: "template-setup",
      setup: ["echo template-setup"],
    });

    expect(harness.processes).toHaveLength(2);
    expect(harness.processes[0]?.options.command).toContain(
      "echo template-setup"
    );
    expect(harness.processes[1]?.options.command).toBe("bun run dev");
  });

  it("can stop and restart a single service", async () => {
    const { cell, harness } = await createStartedHarness("template-restart");

    const service = await getOnlyService(cell.id);

    expect(service?.status).toBe("running");

    await harness.supervisor.stopCellService(service.id);

    const [stopped] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));
    expect(stopped?.status).toBe("stopped");

    await harness.supervisor.startCellService(service.id);

    const [restarted] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));
    expect(restarted?.status).toBe("running");

    await stopCellHarness(harness, cell.id);
  });

  it("restores persisted services during bootstrap", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-bootstrap");

    const persistedPort = await allocateFreePort();

    await insertServiceRecord(workspace, cell.id, {
      id: "svc-bootstrap",
      status: "running",
      port: persistedPort,
    });

    const harness = createHarness();
    await harness.supervisor.bootstrap();

    expect(harness.processes).toHaveLength(1);
    const call = firstProcess(harness, "Expected process to restart");
    expect(call.options.env.WEB_PORT).toBe(String(persistedPort));

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, "svc-bootstrap"));

    expect(service?.pid).toBe(call.handle.pid);
    const terminalSession =
      harness.terminalRuntime.getServiceSession("svc-bootstrap");
    expect(terminalSession?.status).toBe("running");
    expect(terminalSession?.pid).toBe(call.handle.pid);

    await stopHarness(harness);
  });

  it("restarts services after Hive shutdown stopAll", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-shutdown-restart");

    const initialHarness = createHarness();

    await ensureProcessServices({
      harness: initialHarness,
      cell,
      templateId: "template-shutdown-restart",
    });

    await stopHarness(initialHarness);

    const [stoppedForShutdown] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

    expect(stoppedForShutdown?.status).toBe("needs_resume");
    expect(stoppedForShutdown?.pid).toBeNull();

    const restartHarness = createHarness();
    await restartHarness.supervisor.bootstrap();

    expect(restartHarness.processes).toHaveLength(1);

    const [restarted] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

    expect(restarted?.status).toBe("running");
    expect(restarted?.pid).toBe(
      restartHarness.processes[0]?.handle.pid ?? null
    );

    await stopHarness(restartHarness);
  });

  it("does not restart manually stopped services during bootstrap", async () => {
    const { cell, harness: initialHarness } = await createStartedHarness(
      "template-manual-stop"
    );

    const service = await getOnlyService(cell.id);

    await initialHarness.supervisor.stopCellService(service.id);

    const restartHarness = createHarness();
    await restartHarness.supervisor.bootstrap();

    expect(restartHarness.processes).toHaveLength(0);

    const [stillStopped] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));

    expect(stillStopped?.status).toBe("stopped");
    expect(stillStopped?.pid).toBeNull();
  });

  it("restarts only shutdown-marked services after mixed stop states", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-mixed-resume");

    const initialHarness = createHarness();

    await ensureProcessServices({
      harness: initialHarness,
      cell,
      templateId: "template-mixed-resume",
      services: {
        web: serviceDefinition(),
        worker: serviceDefinition({ run: "bun run worker" }),
      },
    });

    const initialRows = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));
    const workerService = initialRows.find(
      (service) => service.name === "worker"
    );
    if (!workerService) {
      throw new Error("Expected worker service to exist");
    }

    await initialHarness.supervisor.stopCellService(workerService.id);
    await stopHarness(initialHarness);

    const afterShutdown = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));
    const webAfterShutdown = afterShutdown.find(
      (service) => service.name === "web"
    );
    const workerAfterShutdown = afterShutdown.find(
      (service) => service.name === "worker"
    );

    expect(webAfterShutdown?.status).toBe("needs_resume");
    expect(workerAfterShutdown?.status).toBe("stopped");

    const restartHarness = createHarness();
    await restartHarness.supervisor.bootstrap();

    expect(restartHarness.processes).toHaveLength(1);

    const afterBootstrap = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));
    const webAfterBootstrap = afterBootstrap.find(
      (service) => service.name === "web"
    );
    const workerAfterBootstrap = afterBootstrap.find(
      (service) => service.name === "worker"
    );

    expect(webAfterBootstrap?.status).toBe("running");
    expect(workerAfterBootstrap?.status).toBe("stopped");

    await stopHarness(restartHarness);
  });

  it("stops running services and clears pid", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-stop");

    const harness = createHarness();

    await ensureProcessServices({
      harness,
      cell,
      templateId: "template-stop",
      services: {
        server: serviceDefinition(),
      },
    });

    await harness.supervisor.stopCellServices(cell.id, {
      releasePorts: true,
    });

    await Promise.all(harness.processes.map((proc) => proc.handle.exited));

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

    expect(service?.status).toBe("stopped");
    expect(service?.pid).toBeNull();
  });

  it("signals process groups when stopping by pid", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-stop-group");

    const pid = 4242;

    await insertServiceRecord(workspace, cell.id, {
      id: "svc-stop-group",
      status: "running",
      pid,
    });

    const calls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    const originalKill = process.kill;
    process.kill = ((target: number, signal?: NodeJS.Signals | number) => {
      calls.push({ pid: target, signal });
      return true as never;
    }) as typeof process.kill;

    try {
      const harness = createHarness();
      await harness.supervisor.stopCellService("svc-stop-group");
    } finally {
      process.kill = originalKill;
    }

    expect(
      calls.some((call) => call.pid === -pid && call.signal === "SIGTERM")
    ).toBe(true);
    expect(
      calls.some((call) => call.pid === -pid && call.signal === "SIGKILL")
    ).toBe(true);
  });

  it("restarts a stopped service even when its previous port is occupied", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-port-collision");
    const occupiedPort = await allocateFreePort();

    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(occupiedPort, "127.0.0.1", () => resolve());
    });

    await insertServiceRecord(workspace, cell.id, {
      id: "svc-port-collision",
      status: "stopped",
      port: occupiedPort,
    });

    const harness = createHarness();

    try {
      await harness.supervisor.startCellService("svc-port-collision");

      expect(harness.processes).toHaveLength(1);
      const assignedPort = Number(
        harness.processes[0]?.options.env.WEB_PORT ?? "0"
      );
      expect(assignedPort).toBeGreaterThan(0);
      expect(assignedPort).not.toBe(occupiedPort);

      const [service] = await testDb
        .select()
        .from(cellServices)
        .where(eq(cellServices.id, "svc-port-collision"));

      expect(service?.status).toBe("running");
      expect(service?.pid).toBe(harness.processes[0]?.handle.pid ?? null);
      expect(service?.port).toBe(assignedPort);

      await harness.supervisor.stopCellService("svc-port-collision");
      await waitForProcesses(harness);
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  async function insertCell(workspacePath: string, templateId: string) {
    const [cell] = await testDb
      .insert(cells)
      .values({
        id: randomUUID(),
        name: `Cell-${templateId}`,
        templateId,
        workspacePath,
        workspaceId: `workspace-${templateId}`,
        workspaceRootPath: resolveWorkspaceRoot(),
        description: null,
        opencodeSessionId: null,
        createdAt: new Date(),
        status: "ready",
        lastSetupError: null,
      })
      .returning();

    if (!cell) {
      throw new Error("Failed to insert cell");
    }

    return cell;
  }

  function serviceDefinition(
    overrides: Partial<{
      run: string;
      cwd: string;
      env: Record<string, string>;
    }> = {}
  ) {
    return {
      type: "process" as const,
      run: "bun run dev",
      cwd: ".",
      ...overrides,
    };
  }

  async function ensureProcessServices({
    harness,
    cell,
    templateId,
    services = { web: serviceDefinition() },
    setup,
  }: {
    harness: ReturnType<typeof createHarness>;
    cell: Awaited<ReturnType<typeof insertCell>>;
    templateId: string;
    services?: Record<string, ReturnType<typeof serviceDefinition>>;
    setup?: string[];
  }) {
    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: templateId,
        label: "Template",
        type: "manual",
        setup,
        services,
      },
    });
  }

  async function createStartedHarness(
    templateId: string,
    services?: Record<string, ReturnType<typeof serviceDefinition>>
  ) {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, templateId);
    const harness = createHarness();

    await ensureProcessServices({ harness, cell, templateId, services });
    return { workspace, cell, harness };
  }

  async function getOnlyService(cellId: string) {
    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cellId));

    if (!service) {
      throw new Error("Expected service to exist");
    }

    return service;
  }

  async function insertServiceRecord(
    workspace: string,
    cellId: string,
    overrides: Partial<typeof cellServices.$inferInsert>
  ) {
    const definition = serviceDefinition({ env: {} });
    await testDb.insert(cellServices).values({
      id: "svc-test",
      cellId,
      name: "web",
      type: "process",
      command: definition.run,
      cwd: workspace,
      env: {},
      status: "running",
      port: null,
      pid: null,
      readyTimeoutMs: null,
      definition,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  }

  async function stopHarness(harness: ReturnType<typeof createHarness>) {
    await harness.supervisor.stopAll();
    await waitForProcesses(harness);
  }

  async function stopCellHarness(
    harness: ReturnType<typeof createHarness>,
    cellId: string
  ) {
    await harness.supervisor.stopCellServices(cellId, { releasePorts: true });
    await waitForProcesses(harness);
  }

  async function waitForProcesses(harness: ReturnType<typeof createHarness>) {
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  }

  function firstProcess(
    harness: ReturnType<typeof createHarness>,
    error: string
  ) {
    const call = harness.processes[0];
    if (!call) {
      throw new Error(error);
    }
    return call;
  }

  function createHarness() {
    const processes: FakeProcess[] = [];
    const runCommandCalls: string[] = [];
    let pidCounter = 10_000;
    let clock = Date.now();
    const terminalRuntime = createServiceTerminalRuntime();

    const spawnProcess: SpawnProcess = (options) => {
      let exit!: (code: number) => void;
      const exited = new Promise<number>((resolveExit) => {
        exit = resolveExit;
      });

      const handle: ProcessHandle = {
        pid: pidCounter++,
        kill: () => exit(0),
        exited,
      };

      processes.push({ options, exit, handle });
      if (options.command.includes("template-setup")) {
        queueMicrotask(() => {
          options.onData?.("template setup complete\n");
          options.onExit?.({ exitCode: 0, signal: null });
          exit(0);
        });
      } else {
        queueMicrotask(() => {
          options.onData?.(`[mock] started ${options.command}\n`);
        });
      }
      return handle;
    };

    const runCommand: RunCommand = (command) => {
      runCommandCalls.push(command);
      return Promise.resolve();
    };

    const supervisor = createServiceSupervisor({
      db: testDb,
      spawnProcess,
      runCommand,
      now: () => new Date(clock++),
      logger: silentLogger,
      terminalRuntime,
    });

    return { supervisor, processes, runCommandCalls, terminalRuntime };
  }

  async function createWorkspaceDir() {
    const dir = await mkdtemp(join(tmpdir(), "hive-services-"));
    workspaceDirs.push(dir);
    return dir;
  }

  async function allocateFreePort(): Promise<number> {
    return await new Promise((resolvePort, rejectPort) => {
      const server = createServer();
      server.once("error", (error) => {
        server.close(() => rejectPort(error));
      });
      server.listen(0, () => {
        const address = server.address();
        const port = address && typeof address === "object" ? address.port : 0;
        server.close(() => resolvePort(port));
      });
    });
  }
});
