import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../../config/context";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
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

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-web",
        label: "Template",
        type: "manual",
        services: {
          web: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
            env: {
              NODE_ENV: "test",
            },
          },
        },
      },
    });

    expect(harness.processes).toHaveLength(1);
    const call = harness.processes[0];
    if (!call) {
      throw new Error("Expected process to be recorded");
    }
    expect(call.options.cwd).toBe(workspace);
    expect(call.options.env.NODE_ENV).toBe("test");
    expect(call.options.env.WEB_PORT).toBeDefined();
    expect(call.options.env.PORT).toBe(call.options.env.WEB_PORT);

    const [service] = await testDb.select().from(cellServices);
    expect(service?.status).toBe("running");
    expect(typeof service?.port).toBe("number");

    await harness.supervisor.stopCellServices(cell.id, {
      releasePorts: true,
    });
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("creates log files inside cell workspace", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-web");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-web",
        label: "Template",
        type: "manual",
        services: {
          web: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    const logPath = join(workspace, ".hive", "logs", "web.log");
    expect(existsSync(logPath)).toBe(true);
  });

  it("does not start duplicate services when pid is alive", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-dup");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-dup",
        label: "Template",
        type: "manual",
        services: {
          server: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

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

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-dup",
        label: "Template",
        type: "manual",
        services: {
          server: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    process.kill = originalKill;

    expect(harness.processes).toHaveLength(1);
  });

  it("does not start duplicate services on concurrent start", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-concurrent");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-concurrent",
        label: "Template",
        type: "manual",
        services: {
          web: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

    if (!service) {
      throw new Error("Expected service to exist");
    }

    await harness.supervisor.stopCellService(service.id);

    const startingCount = harness.processes.length;

    await Promise.all([
      harness.supervisor.startCellService(service.id),
      harness.supervisor.startCellService(service.id),
    ]);

    expect(harness.processes).toHaveLength(startingCount + 1);

    await harness.supervisor.stopCellServices(cell.id, {
      releasePorts: true,
    });
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("runs template setup commands before starting services", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-setup");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-setup",
        label: "Template",
        type: "manual",
        setup: ["echo template-setup"],
        services: {
          web: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    expect(harness.runCommandCalls).toHaveLength(1);
    expect(harness.runCommandCalls[0]).toContain("echo template-setup");
  });

  it("can stop and restart a single service", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-restart");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-restart",
        label: "Template",
        type: "manual",
        services: {
          web: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
      },
    });

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));

    expect(service?.status).toBe("running");
    if (!service) {
      throw new Error("Missing service record");
    }

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

    await harness.supervisor.stopCellServices(cell.id, {
      releasePorts: true,
    });
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("restores persisted services during bootstrap", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-bootstrap");

    const definition = {
      type: "process" as const,
      run: "bun run dev",
      cwd: ".",
      env: {},
    };

    const timestamp = new Date();
    const persistedPort = await allocateFreePort();

    await testDb.insert(cellServices).values({
      id: "svc-bootstrap",
      cellId: cell.id,
      name: "web",
      type: "process",
      command: definition.run,
      cwd: workspace,
      env: {},
      status: "running",
      port: persistedPort,
      pid: null,
      readyTimeoutMs: null,
      definition,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const harness = createHarness();
    await harness.supervisor.bootstrap();

    expect(harness.processes).toHaveLength(1);
    const call = harness.processes[0];
    if (!call) {
      throw new Error("Expected process to restart");
    }
    expect(call.options.env.WEB_PORT).toBe(String(persistedPort));

    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, "svc-bootstrap"));

    expect(service?.pid).toBe(call.handle.pid);

    await harness.supervisor.stopAll();
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("stops running services and clears pid", async () => {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell(workspace, "template-stop");

    const harness = createHarness();

    await harness.supervisor.ensureCellServices({
      cell,
      template: {
        id: "template-stop",
        label: "Template",
        type: "manual",
        services: {
          server: {
            type: "process",
            run: "bun run dev",
            cwd: ".",
          },
        },
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
        opencodeServerUrl: null,
        opencodeServerPort: null,
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

  function createHarness() {
    const processes: FakeProcess[] = [];
    const runCommandCalls: string[] = [];
    let pidCounter = 10_000;
    let clock = Date.now();

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
    });

    return { supervisor, processes, runCommandCalls };
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
