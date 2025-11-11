import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { constructs } from "../../schema/constructs";
import { constructServices } from "../../schema/services";
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
    await testDb.delete(constructServices);
    await testDb.delete(constructs);
    workspaceDirs = [];
  });

  afterEach(async () => {
    for (const dir of workspaceDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts process services with assigned ports and env", async () => {
    const workspace = await createWorkspaceDir();
    const construct = await insertConstruct(workspace, "template-web");

    const harness = createHarness();

    await harness.supervisor.ensureConstructServices({
      construct,
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

    const [service] = await testDb.select().from(constructServices);
    expect(service?.status).toBe("running");
    expect(typeof service?.port).toBe("number");

    await harness.supervisor.stopConstructServices(construct.id, {
      releasePorts: true,
    });
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("creates log files inside construct workspace", async () => {
    const workspace = await createWorkspaceDir();
    const construct = await insertConstruct(workspace, "template-web");

    const harness = createHarness();

    await harness.supervisor.ensureConstructServices({
      construct,
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

    const expectedLogPath = resolve(workspace, ".synthetic/logs/web.log");
    expect(existsSync(expectedLogPath)).toBe(true);
  });

  it("restores persisted services during bootstrap", async () => {
    const workspace = await createWorkspaceDir();
    const construct = await insertConstruct(workspace, "template-bootstrap");

    const definition = {
      type: "process" as const,
      run: "bun run dev",
      cwd: ".",
      env: {},
    };

    const timestamp = new Date();

    await testDb.insert(constructServices).values({
      id: "svc-bootstrap",
      constructId: construct.id,
      name: "web",
      type: "process",
      command: definition.run,
      cwd: workspace,
      env: {},
      status: "running",
      port: 5555,
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
    expect(call.options.env.WEB_PORT).toBe("5555");

    const [service] = await testDb
      .select()
      .from(constructServices)
      .where(eq(constructServices.id, "svc-bootstrap"));

    expect(service?.pid).toBe(call.handle.pid);

    await harness.supervisor.stopAll();
    await Promise.all(harness.processes.map((proc) => proc.handle.exited));
  });

  it("stops running services and clears pid", async () => {
    const workspace = await createWorkspaceDir();
    const construct = await insertConstruct(workspace, "template-stop");

    const harness = createHarness();

    await harness.supervisor.ensureConstructServices({
      construct,
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

    await harness.supervisor.stopConstructServices(construct.id, {
      releasePorts: true,
    });

    await Promise.all(harness.processes.map((proc) => proc.handle.exited));

    const [service] = await testDb
      .select()
      .from(constructServices)
      .where(eq(constructServices.constructId, construct.id));

    expect(service?.status).toBe("stopped");
    expect(service?.pid).toBeNull();
  });

  async function insertConstruct(workspacePath: string, templateId: string) {
    const [construct] = await testDb
      .insert(constructs)
      .values({
        id: randomUUID(),
        name: `Construct-${templateId}`,
        templateId,
        workspacePath,
        description: null,
        opencodeSessionId: null,
        opencodeServerUrl: null,
        opencodeServerPort: null,
        createdAt: new Date(),
      })
      .returning();

    if (!construct) {
      throw new Error("Failed to insert construct");
    }

    return construct;
  }

  function createHarness() {
    const processes: FakeProcess[] = [];
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

    const runCommand: RunCommand = () => Promise.resolve();

    const supervisor = createServiceSupervisor({
      db: testDb,
      spawnProcess,
      runCommand,
      now: () => new Date(clock++),
      logger: silentLogger,
    });

    return { supervisor, processes };
  }

  async function createWorkspaceDir() {
    const dir = await mkdtemp(join(tmpdir(), "synthetic-services-"));
    workspaceDirs.push(dir);
    return dir;
  }
});
