import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../../config/context";
import type { ProcessService, Template } from "../../config/schema";
import { cells } from "../../schema/cells";
import { cellServicePorts, cellServices } from "../../schema/services";
import { createServiceTerminalRuntime } from "../../services/service-terminal";
import type {
  ProcessHandle,
  RunCommand,
  SpawnProcess,
  SpawnProcessOptions,
} from "../../services/supervisor";
import {
  createServiceSupervisor,
  SERVICE_STOP_GRACE_PERIOD_MS,
} from "../../services/supervisor";
import { createDeferred, setupTestDb, testDb } from "../test-db";

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

const EXPECTED_NAMED_PORT_CLAIMS = 3;
const EXPECTED_PRIMARY_PORT_CLAIMS = 2;
const REUSED_SERVICE_PID = 4343;
const READINESS_SUCCESS_TIMEOUT_MS = 500;
const PERSISTED_MONITOR_SETTLE_MS = 150;
const SERVICE_STATUS_POLL_INTERVAL_MS = 5;
const EXPECTED_SERVICE_STOP_GRACE_PERIOD_MS = 15_000;
const HIVE_CLI_SOURCE_PATH_PATTERN = /packages\/cli\/src\/index\.ts$/;
const bracedPortReference = (suffix = "") => ["$", `{PORT${suffix}}`].join("");
const originalHiveHome = process.env.HIVE_HOME;

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
    await testDb.delete(cellServicePorts);
    await testDb.delete(cellServices);
    await testDb.delete(cells);
    workspaceDirs = [];
    const hiveHome = await mkdtemp(join(tmpdir(), "hive-services-home-"));
    workspaceDirs.push(hiveHome);
    process.env.HIVE_HOME = hiveHome;
  });

  afterEach(async () => {
    for (const dir of workspaceDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    process.env.HIVE_HOME = originalHiveHome;
  });

  it("starts process services with assigned ports and env", async () => {
    const { workspace, cell, harness } = await createScenario({
      templateId: "template-web",
      start: true,
      template: {
        env: { HIVE_CLI_BIN: "/workspace/hive" },
        services: {
          web: serviceDefinition({
            audio: { input: true, output: false },
            env: {
              HIVE_CLI_BIN: "/service/hive",
              HIVE_SERVICE_AUDIO_INPUT: "0",
              HIVE_SERVICE_AUDIO_OUTPUT: "1",
              NODE_ENV: "test",
            },
          }),
        },
      },
    });

    expect(harness.processes).toHaveLength(1);
    const call = firstProcess(harness, "Expected process to be recorded");
    expect(call.options.cwd).toBe(workspace);
    expect(call.options.env.NODE_ENV).toBe("test");
    expect(call.options.env.WEB_PORT).toBeDefined();
    expect(call.options.env.PORT).toBe(call.options.env.WEB_PORT);
    expect(call.options.env.HIVE_CELL_ID).toBe(cell.id);
    expect(call.options.env.HIVE_CLI_BIN).toMatch(HIVE_CLI_SOURCE_PATH_PATTERN);
    expect(call.options.env.HIVE_BROWSE_ROOT).toBe(workspace);
    expect(call.options.env.HIVE_SERVICE_AUDIO_INPUT).toBe("1");
    expect(call.options.env.HIVE_SERVICE_AUDIO_OUTPUT).toBe("0");
    expect(call.options.env.HIVE_HOME).toBe(join(workspace, ".hive", "home"));
    expect(call.options.env.HIVE_CELL_RUNTIME_DIR).toContain(
      `/runtime/cells/${cell.id}`
    );
    expect(call.options.env.HIVE_CELL_ARTIFACTS_DIR).toContain(
      `/artifacts/cells/${cell.id}`
    );

    const [service] = await testDb.select().from(cellServices);
    expect(service?.status).toBe("running");
    expect(typeof service?.port).toBe("number");

    await stopCellHarness(harness, cell.id);
  });

  it("defaults service audio input off and output on", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-audio-defaults",
      start: true,
    });

    const call = firstProcess(harness, "Expected process to be recorded");
    expect(call.options.env.HIVE_SERVICE_AUDIO_INPUT).toBe("0");
    expect(call.options.env.HIVE_SERVICE_AUDIO_OUTPUT).toBe("1");

    await stopCellHarness(harness, cell.id);
  });

  it("rejects service starts when the working directory is missing", async () => {
    const scenario = await createScenario({
      templateId: "template-missing-cwd",
      template: webServiceTemplate({ cwd: "missing" }),
    });

    await expect(
      scenario.harness.supervisor.ensureCellServices({
        cell: scenario.cell,
        template: scenario.template,
      })
    ).rejects.toThrow("Service working directory not found");

    const service = await getOnlyService(scenario.cell.id);
    expect(service.status).toBe("error");
    expect(service.lastKnownError).toContain(
      "Service working directory not found"
    );
    expect(scenario.harness.processes).toHaveLength(0);
  });

  it("captures runtime output in service terminal buffers", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-web",
      start: true,
    });

    const service = await getOnlyService(cell.id);

    const output = harness.terminalRuntime.readServiceOutput(service.id);
    expect(output).toContain("bun run dev");
  });

  it("does not start duplicate services when pid is alive", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-dup",
      start: true,
      template: { services: { server: serviceDefinition() } },
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

    await harness.supervisor.ensureCellServices({ cell, template });

    process.kill = originalKill;

    expect(harness.processes).toHaveLength(1);
  });

  it("does not start duplicate services on concurrent start", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-concurrent",
      start: true,
    });

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
    const { harness } = await createScenario({
      templateId: "template-setup",
      start: true,
      template: { setup: ["echo template-setup"] },
    });

    expect(harness.processes).toHaveLength(2);
    expect(harness.processes[0]?.options.command).toContain(
      "echo template-setup"
    );
    expect(harness.processes[1]?.options.command).toBe("bun run dev");
  });

  it("cancels an in-flight service setup before waiting for the cell lock", async () => {
    const { cell, harness, starting, spawned } = await startPendingScenario({
      templateId: "template-service-setup-cancel",
      template: webServiceTemplate({ setup: ["prepare-web"] }),
    });
    expect(spawned.options.command).toBe("prepare-web");

    const stopping = harness.supervisor.stopCellServices(cell.id);

    await expect(starting).rejects.toThrow("setup cancelled");
    await stopping;
    expect((await getOnlyService(cell.id)).status).toBe("stopped");
    expect(harness.processes).toHaveLength(1);
  });

  it("bounds a hanging service setup command", async () => {
    const previousTimeout = process.env.HIVE_SERVICE_SETUP_COMMAND_TIMEOUT_MS;
    process.env.HIVE_SERVICE_SETUP_COMMAND_TIMEOUT_MS = "5";
    const { cell, harness, template } = await createScenario({
      templateId: "template-service-setup-timeout",
      template: {
        services: {
          web: serviceDefinition({ setup: ["prepare-web"] }),
        },
      },
    });
    try {
      await expect(
        harness.supervisor.ensureCellServices({ cell, template })
      ).rejects.toThrow("setup command timed out after 5ms");
      expect((await getOnlyService(cell.id)).status).toBe("error");
    } finally {
      process.env.HIVE_SERVICE_SETUP_COMMAND_TIMEOUT_MS = previousTimeout;
    }
  });

  it("cancels an in-flight service setup during daemon shutdown", async () => {
    const { cell, harness, starting } = await startPendingScenario({
      templateId: "template-service-setup-shutdown",
      template: webServiceTemplate({ setup: ["prepare-web"] }),
    });

    const stopping = harness.supervisor.stopAll();

    await expect(starting).rejects.toThrow("setup cancelled");
    await stopping;
    expect((await getOnlyService(cell.id)).status).toBe("needs_resume");
  });

  it("cancels template setup before waiting for the cell lock", async () => {
    const { cell, harness, starting, spawned } = await startPendingScenario({
      templateId: "template-setup-cancel",
      template: { setup: ["prepare-template"] },
    });
    expect(spawned.options.command).toBe("prepare-template");

    const stopping = harness.supervisor.stopCellServices(cell.id);

    await expect(starting).rejects.toThrow("Template setup");
    await stopping;
    expect(harness.processes).toHaveLength(1);
    expect((await getOnlyService(cell.id)).status).toBe("stopped");
  });

  it("cancels readiness before waiting for the cell lock", async () => {
    const { cell, harness, starting } = await startPendingScenario({
      templateId: "template-readiness-cancel",
      template: webServiceTemplate({
        ...tcpReadinessService({ readyTimeoutMs: 30_000 }),
      }),
    });

    const stopping = harness.supervisor.stopCellServices(cell.id);

    await expect(starting).rejects.toThrow();
    await stopping;
    expect((await getOnlyService(cell.id)).status).toBe("stopped");
  });

  it("continues shutdown for sibling services after cancelling setup", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-shutdown-siblings",
      template: {
        services: {
          web: serviceDefinition(),
          worker: serviceDefinition({
            run: "run-worker",
            setup: ["prepare-worker"],
          }),
        },
      },
    });
    const starting = harness.supervisor.ensureCellServices({ cell, template });
    await waitForSpawnedCommand(harness, "prepare-worker");

    const stopping = harness.supervisor.stopAll();

    await expect(starting).rejects.toThrow("setup cancelled");
    await stopping;
    const services = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));
    expect(services.map((service) => service.status)).toEqual([
      "needs_resume",
      "needs_resume",
    ]);
    await expect(harness.processes[0]?.handle.exited).resolves.toBe(0);
  });

  it("can stop and restart a single service", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-restart",
      start: true,
      harnessOptions: {
        processKill: (_signal, exit) => exit(1),
      },
    });

    const service = await getOnlyService(cell.id);

    expect(service?.status).toBe("running");

    await harness.supervisor.stopCellService(service.id);

    const [stopped] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));
    expect(stopped?.status).toBe("stopped");
    expect(stopped?.lastKnownError).toBeNull();

    await harness.supervisor.startCellService(service.id);

    const [restarted] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, service.id));
    expect(restarted?.status).toBe("running");

    await stopCellHarness(harness, cell.id);
  });

  it("restores persisted services during bootstrap", async () => {
    const persistedPort = await allocateFreePort();
    const { harness } = await createScenario({
      templateId: "template-bootstrap",
      serviceRecords: [
        { id: "svc-bootstrap", status: "running", port: persistedPort },
      ],
    });

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

  it("marks an occupied fixed port as a bootstrap error", async () => {
    const occupiedPort = await allocateFreePort();
    const listener = createServer();
    await listenOnPort(listener, occupiedPort);
    const definition = serviceDefinition({
      ports: { http: { port: occupiedPort, primary: true } },
    });
    const { cell, harness } = await createScenario({
      templateId: "template-bootstrap-fixed-port",
      serviceRecords: [
        {
          id: "svc-bootstrap-fixed-port",
          status: "needs_resume",
          port: occupiedPort,
          definition,
        },
      ],
    });
    const now = new Date();
    await testDb.insert(cellServicePorts).values({
      serviceId: "svc-bootstrap-fixed-port",
      name: "http",
      port: occupiedPort,
      primary: true,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await harness.supervisor.bootstrap();

      expect(harness.processes).toHaveLength(0);
      const service = await getOnlyService(cell.id);
      expect(service.status).toBe("error");
      expect(service.lastKnownError).toContain(
        `requires host port ${occupiedPort}, but it is unavailable`
      );
    } finally {
      await closeServer(listener);
    }
  });

  it("waits for an owned persisted starting process before marking it running", async () => {
    const pid = 4545;
    const port = await allocateFreePort();
    let observedInstanceId = "persisted-instance";
    const { harness } = await createPersistedStartingScenario({
      templateId: "template-bootstrap-persisted-starting",
      serviceId: "svc-bootstrap-persisted-starting",
      pid,
      port,
      readInstanceId: () => observedInstanceId,
    });
    let alive = true;
    let stopCalls = 0;
    const processKill = createPersistedProcessKillMock(
      pid,
      () => alive,
      () => {
        stopCalls += 1;
        alive = false;
      }
    );

    const listener = createServer();
    try {
      await withProcessKillMock(processKill, async () => {
        const bootstrapping = harness.supervisor.bootstrap();
        await Promise.resolve();
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-starting")).status
        ).toBe("starting");
        await listenOnPort(listener, port);
        await bootstrapping;

        expect(harness.processes).toHaveLength(0);
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-starting")).status
        ).toBe("running");

        observedInstanceId = "reused-instance";
        await waitForServiceStatus("svc-bootstrap-persisted-starting", "error");
        await harness.supervisor.stopCellService(
          "svc-bootstrap-persisted-starting"
        );
        expect(stopCalls).toBe(0);
      });
    } finally {
      await closeServer(listener);
    }
  });

  it("does not overwrite stopped state when persisted readiness is cancelled", async () => {
    const pid = 4747;
    const port = await allocateFreePort();
    const { cell, harness } = await createPersistedStartingScenario({
      templateId: "template-bootstrap-persisted-stop",
      serviceId: "svc-bootstrap-persisted-stop",
      pid,
      port,
    });
    await withStoppablePersistedProcess(pid, async () => {
      const bootstrapping = harness.supervisor.bootstrap();
      await Promise.resolve();
      const stopping = harness.supervisor.stopCellServices(cell.id);
      await Promise.all([bootstrapping, stopping]);
      expect(
        (await getOnlyServiceById("svc-bootstrap-persisted-stop")).status
      ).toBe("stopped");
    });
  });

  it("does not signal a reused pid while cancelling persisted readiness", async () => {
    const pid = 4848;
    const port = await allocateFreePort();
    let observedInstanceId = "persisted-instance";
    const { harness } = await createPersistedStartingScenario({
      templateId: "template-bootstrap-persisted-reused",
      serviceId: "svc-bootstrap-persisted-reused",
      pid,
      port,
      readInstanceId: () => observedInstanceId,
    });
    let stopCalls = 0;
    await withProcessKillMock(
      createPersistedProcessKillMock(
        pid,
        () => true,
        () => {
          stopCalls += 1;
        }
      ),
      async () => {
        const bootstrapping = harness.supervisor.bootstrap();
        await Promise.resolve();
        observedInstanceId = "reused-instance";
        const stopping = harness.supervisor.stopCellService(
          "svc-bootstrap-persisted-reused"
        );
        await Promise.all([bootstrapping, stopping]);
        expect(stopCalls).toBe(0);
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-reused")).status
        ).toBe("stopped");
      }
    );
  });

  it("tracks an adopted process group after its leader exits", async () => {
    const pid = 4949;
    await seedPersistedProcessService(
      "svc-bootstrap-persisted-group",
      pid,
      "persisted-instance"
    );
    const harness = createHarness({
      readProcessEnvironment: async () => ({
        HIVE_SERVICE_INSTANCE_ID: "persisted-instance",
      }),
    });
    let leaderAlive = true;
    let groupAlive = true;
    const signals: Array<number | string | undefined> = [];
    await withProcessKillMock(
      createProcessGroupKillMock({
        pid,
        isLeaderAlive: () => leaderAlive,
        isGroupAlive: () => groupAlive,
        onSignal: (_target, signal) => {
          signals.push(signal);
          leaderAlive = false;
          groupAlive = false;
        },
      }),
      async () => {
        await harness.supervisor.bootstrap();
        leaderAlive = false;
        await new Promise((resolve) =>
          setTimeout(resolve, PERSISTED_MONITOR_SETTLE_MS)
        );
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-group")).status
        ).toBe("running");

        await harness.supervisor.stopCellService(
          "svc-bootstrap-persisted-group"
        );
        expect(signals).toContain("SIGTERM");
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-group")).status
        ).toBe("stopped");
      }
    );
  });

  it("keeps an adopted process tracked when identity becomes unverifiable", async () => {
    const pid = 5050;
    await seedPersistedProcessService(
      "svc-bootstrap-persisted-unverifiable",
      pid,
      "persisted-instance"
    );
    let environmentReadable = true;
    const harness = createHarness({
      readProcessEnvironment: async () =>
        environmentReadable
          ? { HIVE_SERVICE_INSTANCE_ID: "persisted-instance" }
          : null,
    });
    let alive = true;
    let stopCalls = 0;
    await withProcessKillMock(
      createPersistedProcessKillMock(
        pid,
        () => alive,
        () => {
          stopCalls += 1;
          alive = false;
        }
      ),
      async () => {
        await harness.supervisor.bootstrap();
        environmentReadable = false;
        await expect(
          harness.supervisor.stopCellService(
            "svc-bootstrap-persisted-unverifiable"
          )
        ).rejects.toThrow("process identity cannot be verified");
        expect(stopCalls).toBe(0);
        expect(
          (await getOnlyServiceById("svc-bootstrap-persisted-unverifiable"))
            .status
        ).toBe("running");

        environmentReadable = true;
        await harness.supervisor.stopCellService(
          "svc-bootstrap-persisted-unverifiable"
        );
      }
    );
  });

  it("does not restart dependents until an owned persisted dependency is ready", async () => {
    const pid = 4646;
    const port = await allocateFreePort();
    const databaseDefinition = tcpReadinessService({
      run: "start-database",
      readyTimeoutMs: 20,
    });
    const apiDefinition = serviceDefinition({
      run: "start-api",
      dependsOn: ["database"],
    });
    const { harness } = await createScenario({
      templateId: "template-bootstrap-persisted-dependency",
      harnessOptions: {
        readProcessEnvironment: async () => ({
          HIVE_SERVICE_INSTANCE_ID: "persisted-instance",
        }),
      },
      serviceRecords: [
        {
          id: "svc-bootstrap-persisted-database",
          name: "database",
          command: databaseDefinition.run,
          definition: databaseDefinition,
          status: "starting",
          pid,
          port,
          env: { HIVE_SERVICE_INSTANCE_ID: "persisted-instance" },
        },
        {
          id: "svc-bootstrap-persisted-api",
          name: "api",
          command: apiDefinition.run,
          definition: apiDefinition,
          status: "needs_resume",
        },
      ],
    });
    await withStoppablePersistedProcess(pid, () =>
      harness.supervisor.bootstrap()
    );

    expect(harness.processes).toHaveLength(0);
    expect(
      (await getOnlyServiceById("svc-bootstrap-persisted-database")).status
    ).toBe("error");
    const api = await getOnlyServiceById("svc-bootstrap-persisted-api");
    expect(api.status).toBe("error");
    expect(api.lastKnownError).toContain(
      "Dependencies failed during restart: database"
    );
  });

  it("marks queued dependents as starting during bootstrap", async () => {
    const port = await allocateFreePort();
    const databaseDefinition = tcpReadinessService({
      run: "start-database",
      readyTimeoutMs: 1000,
    });
    const apiDefinition = serviceDefinition({
      run: "start-api",
      dependsOn: ["database"],
    });
    const { cell, harness } = await createScenario({
      templateId: "template-bootstrap-queued-dependent",
      serviceRecords: [
        {
          id: "svc-bootstrap-queued-database",
          name: "database",
          command: databaseDefinition.run,
          definition: databaseDefinition,
          status: "needs_resume",
          port,
        },
        {
          id: "svc-bootstrap-queued-api",
          name: "api",
          command: apiDefinition.run,
          definition: apiDefinition,
          status: "running",
          pid: 99_999,
        },
      ],
    });
    const listener = createServer();

    try {
      const bootstrapping = harness.supervisor.bootstrap();
      await harness.firstSpawned;

      const queued = await getOnlyServiceById("svc-bootstrap-queued-api");
      expect(queued.status).toBe("starting");
      expect(queued.lastKnownError).toBeNull();

      await listenOnPort(listener, port);
      await bootstrapping;
      expect(harness.processes).toHaveLength(2);
    } finally {
      await closeServer(listener);
      await stopCellHarness(harness, cell.id);
    }
  });

  it("skips dependent restarts after dependency readiness fails", async () => {
    const databaseDefinition = serviceDefinition({
      run: "start-database",
      readiness: { checks: [{ type: "tcp", port: "default" }] },
      readyTimeoutMs: 10,
    });
    const apiDefinition = serviceDefinition({
      run: "start-api",
      dependsOn: ["database"],
    });
    const workerDefinition = serviceDefinition({ run: "start-worker" });
    const { harness } = await createScenario({
      templateId: "template-bootstrap-dependency",
      serviceRecords: [
        {
          id: "svc-bootstrap-database",
          name: "database",
          command: databaseDefinition.run,
          definition: databaseDefinition,
          status: "needs_resume",
        },
        {
          id: "svc-bootstrap-api",
          name: "api",
          command: apiDefinition.run,
          definition: apiDefinition,
          status: "needs_resume",
        },
        {
          id: "svc-bootstrap-worker",
          name: "worker",
          command: workerDefinition.run,
          definition: workerDefinition,
          status: "needs_resume",
        },
      ],
    });

    await harness.supervisor.bootstrap();

    expect(harness.processes.map((process) => process.options.command)).toEqual(
      ["start-database", "start-worker"]
    );
    const [api] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, "svc-bootstrap-api"));
    expect(api?.status).toBe("error");
    expect(api?.lastKnownError).toContain(
      "Dependencies failed during restart: database"
    );

    await stopHarness(harness);
  });

  it("restarts services after Hive shutdown stopAll", async () => {
    const { cell, harness: initialHarness } = await createScenario({
      templateId: "template-shutdown-restart",
      start: true,
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

  it("prevents in-flight and later starts once shutdown begins", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-shutdown-barrier",
      template: { setup: ["hold-setup"] },
    });
    const ensurePromise = harness.supervisor.ensureCellServices({
      cell,
      template,
    });
    const setupProcess = await harness.firstSpawned;
    expect(setupProcess.options.command).toBe("hold-setup");

    const stopPromise = harness.supervisor.stopAll();
    setupProcess.exit(0);

    await expect(ensurePromise).rejects.toThrow("cancelled");
    await stopPromise;
    expect(harness.processes).toHaveLength(1);

    const service = await getOnlyService(cell.id);
    await expect(
      harness.supervisor.startCellService(service.id)
    ).rejects.toThrow("Service supervisor is shutting down");
    await expect(
      harness.supervisor.ensureCellServices({ cell, template })
    ).rejects.toThrow("Service supervisor is shutting down");
    await expect(harness.supervisor.bootstrap()).rejects.toThrow(
      "Service supervisor is shutting down"
    );
    expect(harness.processes).toHaveLength(1);
  });

  it("does not restart manually stopped services during bootstrap", async () => {
    const { cell, harness: initialHarness } = await createScenario({
      templateId: "template-manual-stop",
      start: true,
    });

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
    const { cell, harness: initialHarness } = await createScenario({
      templateId: "template-mixed-resume",
      start: true,
      template: {
        services: {
          web: serviceDefinition(),
          worker: serviceDefinition({ run: "bun run worker" }),
        },
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
    const { cell, harness } = await createScenario({
      templateId: "template-stop",
      start: true,
      template: { services: { server: serviceDefinition() } },
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
    const pid = 4242;
    await seedPersistedProcessService("svc-stop-group", pid, "owned-instance");

    const calls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    let leaderAlive = true;
    let groupAlive = true;
    await withProcessKillMock(
      createProcessGroupKillMock({
        pid,
        isLeaderAlive: () => leaderAlive,
        isGroupAlive: () => groupAlive,
        onSignal: (target, signal) => {
          calls.push({ pid: target, signal });
          if (target === -pid && signal === "SIGTERM") {
            leaderAlive = false;
          }
          if (target === -pid && signal === "SIGKILL") {
            groupAlive = false;
          }
        },
        onProbe: (target, signal) => calls.push({ pid: target, signal }),
      }),
      async () => {
        const harness = createHarness({
          readProcessEnvironment: async () => ({
            HIVE_SERVICE_INSTANCE_ID: "owned-instance",
          }),
          stopTimeoutMs: 5,
        });
        await harness.supervisor.stopCellService("svc-stop-group");
      }
    );

    expect(
      calls.some((call) => call.pid === -pid && call.signal === "SIGTERM")
    ).toBe(true);
    expect(
      calls.some((call) => call.pid === -pid && call.signal === "SIGKILL")
    ).toBe(true);
  });

  it("does not signal a persisted pid with a mismatched process identity", async () => {
    await seedPersistedProcessService(
      "svc-stop-reused-pid",
      REUSED_SERVICE_PID
    );
    let killCalls = 0;
    const processKill = (() => {
      killCalls += 1;
      return true as never;
    }) as unknown as typeof process.kill;
    await withProcessKillMock(processKill, () =>
      stopPersistedService("svc-stop-reused-pid", {
        HIVE_SERVICE_INSTANCE_ID: "different-instance",
      })
    );

    expect(killCalls).toBe(0);
  });

  it("blocks stopping a live persisted pid when identity is unverifiable", async () => {
    const pid = 4444;
    const serviceId = "svc-stop-unverifiable-pid";
    await seedPersistedProcessService(serviceId, pid);
    const signals: Array<number | string | undefined> = [];
    await withProcessKillMock(
      (_target: number, signal?: number | string) => {
        signals.push(signal);
        if (signal === 0) {
          return true as never;
        }
        throw new Error("unexpected signal");
      },
      async () => {
        await expect(stopPersistedService(serviceId, null)).rejects.toThrow(
          "process identity cannot be verified"
        );
      }
    );

    expect(signals).toEqual([0]);
    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, serviceId));
    expect(service?.status).toBe("running");
    expect(service?.pid).toBe(pid);
  });

  it("kills a surviving process group after the PTY leader exits", async () => {
    let groupAlive = true;
    const signals: Array<number | string | undefined> = [];
    const { cell, harness } = await createScenario({
      templateId: "template-active-group",
      start: true,
      harnessOptions: {
        processKill: (signal, exit) => {
          signals.push(signal);
          if (signal === "SIGTERM") {
            exit(0);
          } else if (signal === "SIGKILL") {
            groupAlive = false;
          }
        },
      },
    });
    const service = await getOnlyService(cell.id);
    const pid = harness.processes[0]?.handle.pid;
    if (!pid) {
      throw new Error("Expected active service pid");
    }
    await withProcessKillMock(
      createProcessGroupKillMock({
        pid,
        isLeaderAlive: () => false,
        isGroupAlive: () => groupAlive,
        onSignal: () => {
          throw new Error("Unexpected direct process signal");
        },
      }),
      () => harness.supervisor.stopCellService(service.id)
    );

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(groupAlive).toBe(false);
  });

  it("defaults to a 15-second graceful stop before escalation", async () => {
    const signals: Array<number | string | undefined> = [];
    const { cell, harness } = await createScenario({
      templateId: "template-graceful-stop-deadline",
      start: true,
      harnessOptions: {
        stopTimeoutMs: 5,
        processKill: (signal, exit) => {
          signals.push(signal);
          if (signal === "SIGKILL") {
            exit(1);
          }
        },
      },
    });

    expect(SERVICE_STOP_GRACE_PERIOD_MS).toBe(
      EXPECTED_SERVICE_STOP_GRACE_PERIOD_MS
    );
    await harness.supervisor.stopCellServices(cell.id);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("restarts a stopped service even when its previous port is occupied", async () => {
    const occupiedPort = await allocateFreePort();

    const listener = createServer();
    await listenOnPort(listener, occupiedPort);

    const { harness } = await createScenario({
      templateId: "template-port-collision",
      serviceRecords: [
        { id: "svc-port-collision", status: "stopped", port: occupiedPort },
      ],
    });

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
      await closeServer(listener);
    }
  });

  it("restarts a service when its persisted pid belongs to another process", async () => {
    const occupiedPort = await allocateFreePort();
    const listener = createServer();
    await listenOnPort(listener, occupiedPort);
    const { harness } = await createReusedPidScenario({
      templateId: "template-reused-start-pid",
      serviceId: "svc-reused-start-pid",
      port: occupiedPort,
    });

    try {
      await withProcessKillMock(createReusedPidKillMock(), async () => {
        await harness.supervisor.startCellService("svc-reused-start-pid");
        const service = await getOnlyServiceById("svc-reused-start-pid");
        expect(service.pid).toBe(harness.processes[0]?.handle.pid);
        expect(service.port).not.toBe(occupiedPort);
      });
    } finally {
      await closeServer(listener);
    }
    await harness.supervisor.stopCellService("svc-reused-start-pid");
  });

  it("allocates named ports and interpolates legacy and named references", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-named-ports",
      start: true,
      template: {
        services: {
          web: serviceDefinition({
            ports: { http: { primary: true }, metrics: {} },
            env: {
              SELF: "$PORT",
              SELF_BRACED: bracedPortReference(),
              API: "$PORT:api",
              API_BRACED: bracedPortReference(":api"),
              METRICS: "$PORT:web:metrics",
              METRICS_BRACED: bracedPortReference(":web:metrics"),
            },
          }),
          api: serviceDefinition({
            run: "bun run api",
            ports: { rpc: { primary: true } },
          }),
        },
      },
    });

    const web = harness.processes.find(
      (process) => process.options.command === "bun run dev"
    );
    if (!web) {
      throw new Error("Expected web process");
    }
    expect(web.options.env.PORT).toBe(web.options.env.WEB_HTTP_PORT);
    expect(web.options.env.SERVICE_PORT).toBe(web.options.env.WEB_PORT);
    expect(web.options.env.SELF).toBe(web.options.env.WEB_HTTP_PORT);
    expect(web.options.env.SELF_BRACED).toBe(web.options.env.WEB_HTTP_PORT);
    expect(web.options.env.API).toBe(web.options.env.API_RPC_PORT);
    expect(web.options.env.API_BRACED).toBe(web.options.env.API_RPC_PORT);
    expect(web.options.env.METRICS).toBe(web.options.env.WEB_METRICS_PORT);
    expect(web.options.env.METRICS_BRACED).toBe(
      web.options.env.WEB_METRICS_PORT
    );

    const claims = await testDb.select().from(cellServicePorts);
    expect(claims).toHaveLength(EXPECTED_NAMED_PORT_CLAIMS);
    expect(claims.filter((claim) => claim.primary)).toHaveLength(
      EXPECTED_PRIMARY_PORT_CLAIMS
    );

    await stopCellHarness(harness, cell.id);
  });

  it("does not reconcile changed port definitions over a live process", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-live-definition",
      template: webServiceTemplate({ ports: { http: { primary: true } } }),
    });
    const initialTemplate = template;
    await harness.supervisor.ensureCellServices({
      cell,
      template: initialTemplate,
    });
    await harness.supervisor.ensureCellServices({
      cell,
      template: initialTemplate,
    });
    expect(harness.processes).toHaveLength(1);
    const claimsBefore = await testDb.select().from(cellServicePorts);

    await expect(
      harness.supervisor.ensureCellServices({
        cell,
        template: {
          ...initialTemplate,
          services: {
            web: serviceDefinition({
              ports: {
                http: { primary: true },
                metrics: { protocol: "tcp" },
              },
            }),
          },
        },
      })
    ).rejects.toThrow(
      'Cannot update service "web" while it is running; stop it before retrying setup'
    );

    expect(await testDb.select().from(cellServicePorts)).toEqual(claimsBefore);
    expect(harness.processes).toHaveLength(1);
    await stopCellHarness(harness, cell.id);
  });

  it("updates a changed definition when the persisted pid was reused", async () => {
    const previousDefinition = serviceDefinition({
      ports: { http: { primary: true } },
    });
    const { cell, harness, template } = await createReusedPidScenario({
      templateId: "template-reused-definition-pid",
      serviceId: "svc-reused-definition-pid",
      definition: previousDefinition,
      template: webServiceTemplate({
        ports: {
          http: { primary: true },
          metrics: { protocol: "tcp" },
        },
      }),
    });

    await withProcessKillMock(createReusedPidKillMock(), () =>
      harness.supervisor.ensureCellServices({ cell, template })
    );

    expect(harness.processes).toHaveLength(1);
    expect((await getOnlyServiceById("svc-reused-definition-pid")).pid).toBe(
      harness.processes[0]?.handle.pid
    );
    expect(
      await testDb
        .select()
        .from(cellServicePorts)
        .where(eq(cellServicePorts.serviceId, "svc-reused-definition-pid"))
    ).toHaveLength(2);
    await stopCellHarness(harness, cell.id);
  });

  it("serializes single-service stop and start operations", async () => {
    const stopStarted = createDeferred();
    const stopBlocked = createDeferred();
    const { cell, harness } = await createScenario({
      templateId: "template-serialized-actions",
      start: true,
      template: {
        services: { web: serviceDefinition({ stop: "stop-web" }) },
      },
      harnessOptions: {
        runCommand: async (command) => {
          if (command === "stop-web") {
            stopStarted.resolve();
            await stopBlocked.promise;
          }
        },
      },
    });
    const service = await getOnlyService(cell.id);

    const stopping = harness.supervisor.stopCellService(service.id);
    await stopStarted.promise;
    const starting = harness.supervisor.startCellService(service.id);
    await Promise.resolve();
    expect(harness.processes).toHaveLength(1);

    stopBlocked.resolve();
    await stopping;
    await starting;
    expect(harness.processes).toHaveLength(2);
    await stopCellHarness(harness, cell.id);
  });

  it("does not start queued or provisioning services after deletion begins", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-deleting-start",
      cell: { status: "deleting" },
      serviceRecords: [{ id: "svc-deleting-start", status: "stopped" }],
    });

    await expect(
      harness.supervisor.startCellService("svc-deleting-start")
    ).rejects.toThrow("is being deleted");
    await expect(
      harness.supervisor.ensureCellServices({
        cell,
        template,
      })
    ).rejects.toThrow("is being deleted");
    expect(harness.processes).toHaveLength(0);
  });

  it("interpolates named port references in stop commands", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-stop-ports",
      start: true,
      template: webServiceTemplate({
        ports: { http: { primary: true }, metrics: {} },
        stop: "stop-web $PORT:web:metrics",
      }),
    });
    const process = firstProcess(harness, "Expected web process");

    await harness.supervisor.stopCellServices(cell.id);

    expect(harness.runCommandCalls).toContain(
      `stop-web ${process.options.env.WEB_METRICS_PORT}`
    );
  });

  it("bounds a hanging stop command and leaves the service stopped", async () => {
    const previousTimeout = process.env.HIVE_SERVICE_STOP_COMMAND_TIMEOUT_MS;
    process.env.HIVE_SERVICE_STOP_COMMAND_TIMEOUT_MS = "5";
    const { cell, harness } = await createScenario({
      templateId: "template-stop-timeout",
      harnessOptions: { useDefaultRunCommand: true },
    });
    try {
      await harness.supervisor.ensureCellServices({
        cell,
        template: templateDefinition("template-stop-timeout", {
          services: { web: serviceDefinition({ stop: "stop-hang" }) },
        }),
      });

      await expect(
        harness.supervisor.stopCellServices(cell.id)
      ).rejects.toThrow("timed out after 5ms");
      expect((await getOnlyService(cell.id)).status).toBe("stopped");
    } finally {
      process.env.HIVE_SERVICE_STOP_COMMAND_TIMEOUT_MS = previousTimeout;
      await harness.supervisor.stopCellServices(cell.id, {
        releasePorts: true,
      });
      await waitForProcesses(harness);
    }
  });

  it("retains legacy primary aliases for implicit default ports", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-legacy-port",
      start: true,
    });
    const process = firstProcess(harness, "Expected legacy service process");

    expect(process.options.env.PORT).toBe(process.options.env.WEB_PORT);
    expect(process.options.env.WEB_DEFAULT_PORT).toBe(
      process.options.env.WEB_PORT
    );
    const [claim] = await testDb.select().from(cellServicePorts);
    expect(claim).toMatchObject({ name: "default", primary: true });

    await stopCellHarness(harness, cell.id);
  });

  it("makes allocated service ports available to template setup", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-setup-ports",
      start: true,
      template: {
        setup: ["echo template-setup"],
        ...webServiceTemplate({ ports: { http: { primary: true } } }),
      },
    });

    expect(harness.processes[0]?.options.env.WEB_PORT).toBeDefined();
    expect(harness.processes[0]?.options.env.WEB_HTTP_PORT).toBe(
      harness.processes[0]?.options.env.WEB_PORT
    );
    expect(harness.processes[0]?.options.env.HIVE_CELL_RUNTIME_DIR).toContain(
      `/runtime/cells/${cell.id}`
    );
    expect(harness.processes[0]?.options.env.HIVE_CELL_ARTIFACTS_DIR).toContain(
      `/artifacts/cells/${cell.id}`
    );
    await stopCellHarness(harness, cell.id);
  });

  it("runs teardown commands sequentially with durable env and persisted named ports", async () => {
    const { workspace, cell, harness, template } = await createScenario({
      templateId: "template-teardown",
      template: {
        env: {
          METRICS_URL: `http://localhost:${bracedPortReference(":web:metrics")}`,
        },
        teardown: [
          `cleanup-one ${bracedPortReference(":web:http")}`,
          "cleanup-two $PORT:web:metrics",
        ],
        services: {
          web: serviceDefinition({
            ports: { http: { primary: true }, metrics: {} },
          }),
        },
      },
    });

    await harness.supervisor.ensureCellServices({ cell, template });
    await harness.supervisor.stopCellServices(cell.id, { releasePorts: true });
    const processCountBeforeTeardown = harness.processes.length;

    await harness.supervisor.runCellTeardown({
      cell,
      template,
      reason: "delete",
    });

    const teardownProcesses = harness.processes.slice(
      processCountBeforeTeardown
    );
    expect(teardownProcesses.map((process) => process.options.command)).toEqual(
      [
        `cleanup-one ${teardownProcesses[0]?.options.env.WEB_HTTP_PORT}`,
        `cleanup-two ${teardownProcesses[0]?.options.env.WEB_METRICS_PORT}`,
      ]
    );
    const environment = teardownProcesses[0]?.options.env;
    expect(environment?.HIVE_CELL_ID).toBe(cell.id);
    expect(environment?.HIVE_HOME).toBe(join(workspace, ".hive", "home"));
    expect(environment?.HIVE_BROWSE_ROOT).toBe(workspace);
    expect(environment?.HIVE_CELL_RUNTIME_DIR).toBe(
      join(process.env.HIVE_HOME ?? "", "runtime", "cells", cell.id)
    );
    expect(environment?.HIVE_CELL_ARTIFACTS_DIR).toBe(
      join(process.env.HIVE_HOME ?? "", "artifacts", "cells", cell.id)
    );
    expect(environment?.HIVE_TEARDOWN_REASON).toBe("delete");
    expect(environment?.WEB_PORT).toBe(environment?.WEB_HTTP_PORT);
    expect(environment?.METRICS_URL).toBe(
      `http://localhost:${environment?.WEB_METRICS_PORT}`
    );
  });

  async function runTeardownScenario(args: {
    templateId: string;
    command: string;
    directory: string;
    baseCommit?: string;
    prepare?: (workspacePath: string) => Promise<void>;
  }): Promise<boolean> {
    const { workspace, cell, harness, template } = await createScenario({
      templateId: args.templateId,
      template: { teardown: [args.command] },
      cell: args.baseCommit ? { baseCommit: args.baseCommit } : undefined,
    });
    cell.workspacePath = join(workspace, args.directory);
    await args.prepare?.(cell.workspacePath);

    await harness.supervisor.runCellTeardown({
      cell,
      template,
      reason: "delete",
    });

    return harness.processes.some(
      (process) => process.options.command === args.command
    );
  }

  it("skips teardown when the cell workspace has only runtime artifacts", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-runtime-only",
        command: "cleanup-never",
        directory: "runtime-only-workspace",
        prepare: async (workspacePath) => {
          await mkdir(join(workspacePath, ".hive"), { recursive: true });
        },
      })
    ).toBe(false);
  });

  it("skips teardown when the cell workspace is already missing", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-missing-workspace",
        command: "cleanup-never",
        directory: "missing-cell-workspace",
      })
    ).toBe(false);
  });

  it("skips teardown when an incomplete workspace has only git metadata", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-git-metadata-only",
        command: "cleanup-never",
        directory: "git-metadata-only",
        prepare: async (workspacePath) => {
          await mkdir(workspacePath);
          await writeFile(join(workspacePath, ".git"), "gitdir: missing");
        },
      })
    ).toBe(false);
  });

  it("runs teardown for a provisioned empty workspace", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-empty-workspace",
        command: "cleanup-empty-workspace",
        directory: "empty-workspace",
        baseCommit: "base-commit",
        prepare: async (workspacePath) => {
          await mkdir(workspacePath);
          await writeFile(join(workspacePath, ".git"), "gitdir: valid");
        },
      })
    ).toBe(true);
  });

  it("runs teardown for a nonempty workspace without git metadata", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-without-git",
        command: "cleanup-without-git",
        directory: "workspace-without-git",
        prepare: async (workspacePath) => {
          await mkdir(workspacePath);
          await writeFile(join(workspacePath, "package.json"), "{}");
        },
      })
    ).toBe(true);
  });

  it("treats intentional OpenCode plugins as workspace source", async () => {
    expect(
      await runTeardownScenario({
        templateId: "template-teardown-opencode-plugin",
        command: "cleanup-opencode-plugin",
        directory: "workspace-with-opencode-plugin",
        prepare: async (workspacePath) => {
          await mkdir(join(workspacePath, ".opencode", "plugin"), {
            recursive: true,
          });
        },
      })
    ).toBe(true);
  });

  it("resumes teardown after the last completed command", async () => {
    let cleanupTwoRuns = 0;
    const { cell, harness, template } = await createScenario({
      templateId: "template-teardown-resume",
      template: {
        teardown: ["cleanup-one", "cleanup-two"],
      },
      harnessOptions: {
        exitCodeForCommand: (command) => {
          if (command === "cleanup-one") {
            return 0;
          }
          if (command === "cleanup-two") {
            cleanupTwoRuns += 1;
            return cleanupTwoRuns === 1 ? 1 : 0;
          }
        },
      },
    });
    await harness.supervisor.ensureCellServices({ cell, template });
    await harness.supervisor.stopCellServices(cell.id);

    await expect(
      harness.supervisor.runCellTeardown({
        cell,
        template,
        reason: "delete",
      })
    ).rejects.toThrow("cleanup-two");
    await harness.supervisor.runCellTeardown({
      cell,
      template,
      reason: "delete",
    });

    expect(
      harness.processes
        .map((process) => process.options.command)
        .filter((command) => command.startsWith("cleanup-"))
    ).toEqual(["cleanup-one", "cleanup-two", "cleanup-two"]);
  });

  it("does not run template teardown during stop or daemon shutdown", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-no-stop-teardown",
      template: { teardown: ["cleanup-never"] },
    });

    await harness.supervisor.ensureCellServices({ cell, template });
    await harness.supervisor.stopCellServices(cell.id);
    await harness.supervisor.stopAll();

    expect(
      harness.processes.some((process) =>
        process.options.command.startsWith("cleanup-")
      )
    ).toBe(false);
  });

  it("applies the configurable teardown command timeout", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-teardown-timeout",
      harnessOptions: { autoExitTeardown: false },
    });
    const previousTimeout =
      process.env.HIVE_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS;
    process.env.HIVE_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS = "5";

    try {
      await expect(
        harness.supervisor.runCellTeardown({
          cell,
          template: templateDefinition("template-teardown-timeout", {
            teardown: ["cleanup-hang"],
          }),
          reason: "provisioning_rollback",
        })
      ).rejects.toThrow("timed out after 5ms");
    } finally {
      process.env.HIVE_TEMPLATE_TEARDOWN_COMMAND_TIMEOUT_MS = previousTimeout;
    }
  });

  it("starts dependencies first and bulk stops in reverse order", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-dependencies",
      start: true,
      template: {
        services: {
          web: serviceDefinition({
            run: "start-web",
            stop: "stop-web",
            dependsOn: ["db"],
          }),
          db: serviceDefinition({ run: "start-db", stop: "stop-db" }),
        },
      },
    });

    expect(harness.processes.map((process) => process.options.command)).toEqual(
      ["start-db", "start-web"]
    );
    await harness.supervisor.stopCellServices(cell.id);
    expect(harness.runCommandCalls).toEqual(["stop-web", "stop-db"]);
  });

  it("starts independent services concurrently and preserves rollback order", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-dependency-waves",
      template: {
        services: {
          db: serviceDefinition({
            run: "start-db",
            setup: ["prepare-db"],
            stop: "stop-db",
          }),
          worker: serviceDefinition({
            run: "start-worker",
            setup: ["prepare-worker"],
            stop: "stop-worker",
          }),
          app: serviceDefinition({
            run: "start-app",
            setup: ["prepare-app"],
            dependsOn: ["db", "worker"],
          }),
        },
      },
    });

    const starting = harness.supervisor.ensureCellServices({ cell, template });
    const [dbSetup, workerSetup] = await Promise.all([
      waitForSpawnedCommand(harness, "prepare-db"),
      waitForSpawnedCommand(harness, "prepare-worker"),
    ]);
    expect(harness.processes.map((process) => process.options.command)).toEqual(
      ["prepare-db", "prepare-worker"]
    );

    dbSetup.exit(0);
    workerSetup.exit(0);
    const appSetup = await waitForSpawnedCommand(harness, "prepare-app");
    expect(
      harness.processes.some(
        (process) => process.options.command === "start-db"
      )
    ).toBe(true);
    expect(
      harness.processes.some(
        (process) => process.options.command === "start-worker"
      )
    ).toBe(true);
    appSetup.exit(1);

    await expect(starting).rejects.toThrow('Command "prepare-app" failed');
    await harness.supervisor.stopCellServices(cell.id);
    expect(harness.runCommandCalls).toEqual(["stop-worker", "stop-db"]);
  });

  it("cancels sibling readiness when a concurrent service fails", async () => {
    const { cell, harness, template } = await createScenario({
      templateId: "template-failed-service-wave",
      template: {
        services: {
          failing: serviceDefinition({
            run: "run-failing",
            setup: ["prepare-failing"],
          }),
          waiting: tcpReadinessService({
            run: "run-waiting",
            readyTimeoutMs: 30_000,
          }),
        },
      },
    });

    const starting = harness.supervisor.ensureCellServices({ cell, template });
    const [failingSetup, waitingProcess] = await Promise.all([
      waitForSpawnedCommand(harness, "prepare-failing"),
      waitForSpawnedCommand(harness, "run-waiting"),
    ]);

    failingSetup.exit(1);

    await expect(starting).rejects.toThrow('Command "prepare-failing" failed');
    await expect(waitingProcess.handle.exited).resolves.toBe(0);
  });

  it("starts the dependency closure when a single service is started", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-dependency-closure",
      start: true,
      template: {
        services: {
          web: serviceDefinition({ run: "start-web", dependsOn: ["api"] }),
          api: serviceDefinition({ run: "start-api", dependsOn: ["db"] }),
          db: serviceDefinition({ run: "start-db" }),
        },
      },
    });
    await harness.supervisor.stopCellServices(cell.id);
    const startingCount = harness.processes.length;
    const rows = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.cellId, cell.id));
    const web = rows.find((service) => service.name === "web");
    if (!web) {
      throw new Error("Expected web service");
    }

    await harness.supervisor.startCellService(web.id);

    expect(
      harness.processes
        .slice(startingCount)
        .map((process) => process.options.command)
    ).toEqual(["start-db", "start-api", "start-web"]);
    await stopCellHarness(harness, cell.id);
  });

  it("rejects unsupported services before template setup", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-docker",
    });
    const template = {
      id: "template-docker",
      label: "Docker",
      type: "manual",
      setup: ["echo template-setup"],
      services: {
        db: { type: "docker", image: "postgres:17" },
      },
    } as const;

    await expect(
      harness.supervisor.ensureCellServices({
        cell,
        template: template as unknown as Template,
      })
    ).rejects.toThrow('Unsupported service type "docker" for service "db"');
    expect(harness.processes).toHaveLength(0);
    expect(await testDb.select().from(cellServices)).toHaveLength(0);
  });

  it("marks a service error when readiness reaches its deadline", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-readiness-timeout",
    });

    await expect(
      harness.supervisor.ensureCellServices({
        cell,
        template: templateDefinition("template-readiness-timeout", {
          services: {
            web: serviceDefinition({
              readiness: {
                checks: [{ type: "tcp", port: "default" }],
                intervalMs: 5,
              },
              readyTimeoutMs: 30,
            }),
          },
        }),
      })
    ).rejects.toThrow("readiness timed out after 30ms");

    const service = await getOnlyService(cell.id);
    expect(service.status).toBe("error");
    expect(service.pid).toBeNull();
    expect(service.lastKnownError).toContain("readiness timed out after 30ms");
  });

  it("marks a spawned process running only after readiness succeeds", async () => {
    const { cell, harness } = await createScenario({
      templateId: "template-readiness-success",
    });
    const starting = harness.supervisor.ensureCellServices({
      cell,
      template: templateDefinition("template-readiness-success", {
        services: {
          web: serviceDefinition({
            readiness: {
              checks: [{ type: "tcp", port: "default" }],
              intervalMs: 5,
            },
            readyTimeoutMs: READINESS_SUCCESS_TIMEOUT_MS,
          }),
        },
      }),
    });
    const spawned = await harness.firstSpawned;
    const whileWaiting = await getOnlyService(cell.id);
    expect(whileWaiting.status).toBe("starting");

    const listener = createServer();
    await listenOnPort(listener, Number(spawned.options.env.PORT));
    try {
      await starting;
      const ready = await getOnlyService(cell.id);
      expect(ready.status).toBe("running");
    } finally {
      await stopCellHarness(harness, cell.id);
      await closeServer(listener);
    }
  });

  async function insertCell(options: {
    workspacePath: string;
    templateId: string;
    overrides?: Partial<typeof cells.$inferInsert>;
  }) {
    const [cell] = await testDb
      .insert(cells)
      .values({
        id: randomUUID(),
        name: `Cell-${options.templateId}`,
        templateId: options.templateId,
        workspacePath: options.workspacePath,
        workspaceId: `workspace-${options.templateId}`,
        workspaceRootPath: resolveWorkspaceRoot(),
        description: null,
        opencodeSessionId: null,
        createdAt: new Date(),
        status: "ready",
        lastSetupError: null,
        ...options.overrides,
      })
      .returning();

    if (!cell) {
      throw new Error("Failed to insert cell");
    }

    return cell;
  }

  function serviceDefinition(
    overrides: Partial<Omit<ProcessService, "type">> = {}
  ): ProcessService {
    return {
      type: "process" as const,
      run: "bun run dev",
      cwd: ".",
      ...overrides,
    };
  }

  function tcpReadinessService(
    overrides: Partial<Omit<ProcessService, "type">> = {}
  ): ProcessService {
    return serviceDefinition({
      readiness: {
        checks: [{ type: "tcp", port: "default" }],
        intervalMs: 5,
      },
      readyTimeoutMs: READINESS_SUCCESS_TIMEOUT_MS,
      ...overrides,
    });
  }

  function templateDefinition(
    templateId: string,
    overrides: Partial<Omit<Template, "id" | "label" | "type">> = {}
  ): Template {
    return {
      id: templateId,
      label: "Template",
      type: "manual",
      services: { web: serviceDefinition() },
      ...overrides,
    };
  }

  function webServiceTemplate(service: Partial<Omit<ProcessService, "type">>) {
    return { services: { web: serviceDefinition(service) } };
  }

  async function createScenario(options: {
    templateId: string;
    start?: boolean;
    template?: Partial<Omit<Template, "id" | "label" | "type">>;
    harnessOptions?: Parameters<typeof createHarness>[0];
    serviceRecords?: Partial<typeof cellServices.$inferInsert>[];
    cell?: Partial<typeof cells.$inferInsert>;
  }) {
    const workspace = await createWorkspaceDir();
    const cell = await insertCell({
      workspacePath: workspace,
      templateId: options.templateId,
      overrides: options.cell,
    });
    const harness = createHarness(options.harnessOptions);
    const template = templateDefinition(options.templateId, options.template);

    if (options.serviceRecords?.length) {
      await testDb.insert(cellServices).values(
        options.serviceRecords.map((overrides) =>
          serviceRecordDefinition({
            workspace,
            cellId: cell.id,
            overrides,
          })
        )
      );
    }
    if (options.start) {
      await harness.supervisor.ensureCellServices({ cell, template });
    }
    return { workspace, cell, harness, template };
  }

  async function startPendingScenario(
    options: Parameters<typeof createScenario>[0]
  ) {
    const scenario = await createScenario(options);
    const starting = scenario.harness.supervisor.ensureCellServices({
      cell: scenario.cell,
      template: scenario.template,
    });
    const spawned = await scenario.harness.firstSpawned;
    return { ...scenario, spawned, starting };
  }

  async function createPersistedStartingScenario(args: {
    templateId: string;
    serviceId: string;
    pid: number;
    port: number;
    definition?: ProcessService;
    readInstanceId?: () => string;
  }) {
    const definition = args.definition ?? tcpReadinessService();
    return await createScenario({
      templateId: args.templateId,
      harnessOptions: {
        readProcessEnvironment: async () => ({
          HIVE_SERVICE_INSTANCE_ID:
            args.readInstanceId?.() ?? "persisted-instance",
        }),
      },
      serviceRecords: [
        {
          id: args.serviceId,
          status: "starting",
          pid: args.pid,
          port: args.port,
          env: { HIVE_SERVICE_INSTANCE_ID: "persisted-instance" },
          definition,
        },
      ],
    });
  }

  async function createReusedPidScenario(args: {
    templateId: string;
    serviceId: string;
    port?: number;
    definition?: ProcessService;
    template?: Partial<Omit<Template, "id" | "label" | "type">>;
  }) {
    const definition = args.definition ?? serviceDefinition();
    return await createScenario({
      templateId: args.templateId,
      template: args.template,
      harnessOptions: {
        readProcessEnvironment: async () => ({
          HIVE_SERVICE_INSTANCE_ID: "different-instance",
        }),
      },
      serviceRecords: [
        {
          id: args.serviceId,
          status: "needs_resume",
          pid: REUSED_SERVICE_PID,
          port: args.port,
          env: { HIVE_SERVICE_INSTANCE_ID: "expected-instance" },
          command: definition.run,
          definition,
        },
      ],
    });
  }

  function createReusedPidKillMock(): typeof process.kill {
    return createPersistedProcessKillMock(
      REUSED_SERVICE_PID,
      () => true,
      () => {
        throw new Error("Reused process must not be stopped");
      }
    );
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

  async function getOnlyServiceById(serviceId: string) {
    const [service] = await testDb
      .select()
      .from(cellServices)
      .where(eq(cellServices.id, serviceId));
    if (!service) {
      throw new Error(`Expected service ${serviceId}`);
    }
    return service;
  }

  async function waitForServiceStatus(
    serviceId: string,
    status: typeof cellServices.$inferSelect.status
  ): Promise<void> {
    const deadline = Date.now() + READINESS_SUCCESS_TIMEOUT_MS;
    while ((await getOnlyServiceById(serviceId)).status !== status) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for service ${serviceId} to ${status}`
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SERVICE_STATUS_POLL_INTERVAL_MS)
      );
    }
  }

  async function waitForSpawnedCommand(
    harness: ReturnType<typeof createHarness>,
    command: string
  ): Promise<FakeProcess> {
    const deadline = Date.now() + READINESS_SUCCESS_TIMEOUT_MS;
    while (true) {
      const process = harness.processes.find(
        (candidate) => candidate.options.command === command
      );
      if (process) {
        return process;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for command ${command}`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SERVICE_STATUS_POLL_INTERVAL_MS)
      );
    }
  }

  function serviceRecordDefinition(options: {
    workspace: string;
    cellId: string;
    overrides?: Partial<typeof cellServices.$inferInsert>;
  }): typeof cellServices.$inferInsert {
    const definition = serviceDefinition({ env: {} });
    return {
      id: "svc-test",
      cellId: options.cellId,
      name: "web",
      type: "process",
      command: definition.run,
      cwd: options.workspace,
      env: {},
      status: "running",
      port: null,
      pid: null,
      readyTimeoutMs: null,
      definition,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...options.overrides,
    };
  }

  async function seedPersistedProcessService(
    serviceId: string,
    pid: number,
    instanceId = "expected-instance"
  ) {
    await createScenario({
      templateId: `template-${serviceId}`,
      serviceRecords: [
        {
          id: serviceId,
          status: "running",
          pid,
          env: { HIVE_SERVICE_INSTANCE_ID: instanceId },
        },
      ],
    });
  }

  async function withProcessKillMock<Result>(
    mock: typeof process.kill,
    action: () => Promise<Result>
  ): Promise<Result> {
    const originalKill = process.kill;
    process.kill = mock;
    try {
      return await action();
    } finally {
      process.kill = originalKill;
    }
  }

  async function withStoppablePersistedProcess<Result>(
    pid: number,
    action: () => Promise<Result>
  ): Promise<Result> {
    let alive = true;
    return await withProcessKillMock(
      createPersistedProcessKillMock(
        pid,
        () => alive,
        () => {
          alive = false;
        }
      ),
      action
    );
  }

  function createProcessGroupKillMock(args: {
    pid: number;
    isLeaderAlive: () => boolean;
    isGroupAlive: () => boolean;
    onProbe?: (target: number, signal: 0) => void;
    onSignal: (target: number, signal?: number | NodeJS.Signals) => void;
  }): typeof process.kill {
    return ((target: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0) {
        args.onProbe?.(target, signal);
        if (
          (target === args.pid && args.isLeaderAlive()) ||
          (target === -args.pid && args.isGroupAlive())
        ) {
          return true as never;
        }
        throwProcessMissing();
      }
      args.onSignal(target, signal);
      return true as never;
    }) as typeof process.kill;
  }

  function throwProcessMissing(): never {
    throw Object.assign(new Error("process missing"), { code: "ESRCH" });
  }

  function createPersistedProcessKillMock(
    pid: number,
    isAlive: () => boolean,
    stop: () => void
  ): typeof process.kill {
    return createProcessGroupKillMock({
      pid,
      isLeaderAlive: isAlive,
      isGroupAlive: isAlive,
      onSignal: (target) => {
        if (target !== pid && target !== -pid) {
          throwProcessMissing();
        }
        stop();
      },
    });
  }

  async function stopPersistedService(
    serviceId: string,
    environment: Record<string, string> | null
  ): Promise<void> {
    const harness = createHarness({
      readProcessEnvironment: async () => environment,
    });
    await harness.supervisor.stopCellService(serviceId);
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

  function createHarness(
    harnessOptions: {
      autoExitTeardown?: boolean;
      exitCodeForCommand?: (command: string) => number | undefined;
      processKill?: (
        signal: number | string | undefined,
        exit: (code: number) => void,
        pid: number
      ) => void;
      runCommand?: RunCommand;
      useDefaultRunCommand?: boolean;
      readProcessEnvironment?: (
        pid: number
      ) => Promise<Record<string, string> | null>;
      stopTimeoutMs?: number;
    } = {}
  ) {
    const processes: FakeProcess[] = [];
    const runCommandCalls: string[] = [];
    const firstSpawned = createDeferred<FakeProcess>();
    let pidCounter = 10_000;
    let clock = Date.now();
    const terminalRuntime = createServiceTerminalRuntime();

    const spawnProcess: SpawnProcess = (options) => {
      const exited = createDeferred<number>();

      const handle: ProcessHandle = {
        pid: pidCounter++,
        kill: (signal) => {
          if (harnessOptions.processKill) {
            harnessOptions.processKill(signal, exited.resolve, handle.pid);
            return;
          }
          exited.resolve(0);
        },
        exited: exited.promise,
      };

      const process = { options, exit: exited.resolve, handle };
      processes.push(process);
      firstSpawned.resolve(process);
      const configuredExitCode = harnessOptions.exitCodeForCommand?.(
        options.command
      );
      if (configuredExitCode !== undefined) {
        queueMicrotask(() => {
          options.onExit?.({ exitCode: configuredExitCode, signal: null });
          exited.resolve(configuredExitCode);
        });
      } else if (
        options.command.includes("template-setup") ||
        (options.command.startsWith("cleanup-") &&
          harnessOptions.autoExitTeardown !== false)
      ) {
        queueMicrotask(() => {
          options.onData?.("template setup complete\n");
          options.onExit?.({ exitCode: 0, signal: null });
          exited.resolve(0);
        });
      } else {
        queueMicrotask(() => {
          options.onData?.(`[mock] started ${options.command}\n`);
        });
      }
      return handle;
    };

    const runCommand: RunCommand = (command, options) => {
      runCommandCalls.push(command);
      return harnessOptions.runCommand?.(command, options) ?? Promise.resolve();
    };

    const supervisor = createServiceSupervisor({
      db: testDb,
      spawnProcess,
      ...(harnessOptions.useDefaultRunCommand ? {} : { runCommand }),
      now: () => new Date(clock++),
      logger: silentLogger,
      terminalRuntime,
      ...(harnessOptions.readProcessEnvironment
        ? { readProcessEnvironment: harnessOptions.readProcessEnvironment }
        : {}),
      ...(harnessOptions.stopTimeoutMs
        ? { stopTimeoutMs: harnessOptions.stopTimeoutMs }
        : {}),
    });

    return {
      supervisor,
      processes,
      runCommandCalls,
      terminalRuntime,
      firstSpawned: firstSpawned.promise,
    };
  }

  async function createWorkspaceDir() {
    const dir = await mkdtemp(join(tmpdir(), "hive-services-"));
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, "package.json"), "{}");
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

  function listenOnPort(
    server: ReturnType<typeof createServer>,
    port: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  }

  function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
  }
});
