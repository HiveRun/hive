// @ts-nocheck
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { HiveConfig } from "../../config/schema";
import { createCellsRoutes, resumeSpawningCells } from "../../routes/cells";

import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import { cellServices } from "../../schema/services";
import type { ServiceSupervisorError } from "../../services/supervisor";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const CREATED_STATUS = 201;
const OK_STATUS = 200;
const BAD_REQUEST_STATUS = 400;
const WAIT_TIMEOUT_MS = 500;
const WAIT_INTERVAL_MS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = WAIT_TIMEOUT_MS
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  throw new Error("Condition not met within timeout");
}

async function waitForCellStatus(cellId: string, status: string) {
  let latestRow: typeof cells.$inferSelect | undefined;
  await waitForCondition(async () => {
    const rows = await testDb.select().from(cells);
    latestRow = rows.find((row) => row.id === cellId);
    return latestRow?.status === status;
  });
  if (!latestRow) {
    throw new Error(`Cell ${cellId} not found`);
  }
  return latestRow;
}

const hiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "mock-model",
  },
  promptSources: [],
  templates: {
    [templateId]: {
      id: templateId,
      label: "Failing Template",
      type: "manual",
      setup: ["bun setup"],
    },
  },
  defaults: {},
};

type SendAgentMessageFn = (sessionId: string, content: string) => Promise<void>;

type DependencyFactoryOptions = {
  setupError?: TemplateSetupError;
  sendAgentMessage?: SendAgentMessageFn;
  onEnsureAgentSession?: (
    cellId: string,
    sessionId: string,
    overrides?: { modelId?: string; providerId?: string }
  ) => void;
  hiveConfigOverride?: HiveConfig;
};

let removeWorktreeCalls = 0;

function createDependencies(options: DependencyFactoryOptions = {}): any {
  const workspaceRecord = {
    id: "test-workspace",
    label: "Test Workspace",
    path: "/tmp/test-workspace-root",
    addedAt: new Date().toISOString(),
  };

  const loadWorkspaceConfig = () =>
    Promise.resolve(options.hiveConfigOverride ?? hiveConfig);

  const buildWorktree = () =>
    Effect.succeed({
      path: workspacePath,
      branch: "cell-branch",
      baseCommit: "abc123",
    });

  const removeWorktreeEffect = () =>
    Effect.sync(() => {
      removeWorktreeCalls += 1;
    });

  const sendAgentMessageImpl =
    options.sendAgentMessage ?? vi.fn<SendAgentMessageFn>().mockResolvedValue();

  return {
    db: testDb,
    resolveWorkspaceContext: (() =>
      Effect.succeed({
        workspace: workspaceRecord,
        loadConfig: () => Effect.promise(loadWorkspaceConfig),
        createWorktreeManager: () =>
          Effect.succeed({
            createWorktree: (_cellId: string) => buildWorktree(),
            removeWorktree: (_cellId: string) => removeWorktreeEffect(),
          }),
        createWorktree: (_cellId: string) => buildWorktree(),
        removeWorktree: (_cellId: string) => removeWorktreeEffect(),
      })) as any,

    ensureAgentSession: (
      cellId: string,
      overrides?: { modelId?: string; providerId?: string }
    ) =>
      Effect.sync(() => {
        const session: AgentSessionRecord = {
          id: `session-${cellId}`,
          cellId,
          templateId,
          provider: "opencode",
          status: "awaiting_input",
          workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        options.onEnsureAgentSession?.(cellId, session.id, overrides);
        return session;
      }),
    closeAgentSession: (_cellId: string) => Effect.void,
    ensureServicesForCell: (_args: any) =>
      options.setupError
        ? Effect.fail({
            _tag: "ServiceSupervisorError",
            cause: options.setupError,
          } as ServiceSupervisorError)
        : Effect.void,
    startServicesForCell: (_cellId: string) => Effect.void,
    stopServicesForCell: (
      _cellId: string,
      _options?: { releasePorts?: boolean }
    ) => Effect.void,
    startServiceById: (_serviceId: string) => Effect.void,
    stopServiceById: (
      _serviceId: string,
      _options?: { releasePorts?: boolean }
    ) => Effect.void,
    sendAgentMessage: (sessionId: string, content: string) =>
      Effect.promise(() => sendAgentMessageImpl(sessionId, content)),
  };
}

describe("POST /api/cells", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
    removeWorktreeCalls = 0;
  });

  it("returns detailed payload when template setup fails", async () => {
    const failingCommand = "bash -lc 'echo FAIL && exit 42'";
    const cause = new CommandExecutionError({
      command: failingCommand,
      cwd: workspacePath,
      exitCode: 42,
    });
    const setupError = new TemplateSetupError({
      command: failingCommand,
      templateId,
      workspacePath,
      cause,
    });

    const routes = createCellsRoutes(createDependencies({ setupError }));
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Broken Cell",
          templateId,
          workspaceId: "test-workspace",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as {
      id: string;
      status: string;
      lastSetupError?: string;
    };

    expect(payload.status).toBe("spawning");
    expect(payload.lastSetupError).toBeUndefined();

    expect(removeWorktreeCalls).toBe(0);

    const erroredRow = await waitForCellStatus(payload.id, "error");
    expect(erroredRow.lastSetupError).toContain(
      "Template ID: failing-template"
    );
    expect(erroredRow.lastSetupError).toContain("exit code 42");

    const rows = await testDb.select().from(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("error");
  });

  it("sends the cell description as the first agent prompt", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockResolvedValue(undefined);
    let capturedSessionId: string | null = null;

    const routes = createCellsRoutes(
      createDependencies({
        sendAgentMessage,
        onEnsureAgentSession: (_cellId, sessionId) => {
          capturedSessionId = sessionId;
        },
      })
    );
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Autostart Cell",
          templateId,
          workspaceId: "test-workspace",
          description: "  Fix the failing specs in apps/web  ",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as { id: string; status: string };
    expect(payload.status).toBe("spawning");

    await waitForCellStatus(payload.id, "ready");
    await waitForCondition(() => Boolean(capturedSessionId));
    await waitForCondition(() => sendAgentMessage.mock.calls.length === 1);

    expect(capturedSessionId).toBeTruthy();
    expect(sendAgentMessage).toHaveBeenCalledWith(
      capturedSessionId,
      "Fix the failing specs in apps/web"
    );
  });

  it("retries initial prompt if agent send fails", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);

    const ensureAgentSession = vi
      .fn<EnsureAgentSessionFn>()
      .mockResolvedValueOnce({ id: "ses_first" })
      .mockResolvedValueOnce({ id: "ses_retry" });

    const routes = createCellsRoutes(
      createDependencies({
        sendAgentMessage,
        ensureAgentSession,
      })
    );
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Retry Cell",
          templateId,
          workspaceId: "test-workspace",
          description: "Try again",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as { id: string; status: string };
    await waitForCellStatus(payload.id, "ready");

    await waitForCondition(() => sendAgentMessage.mock.calls.length === 2);

    expect(sendAgentMessage.mock.calls[0]?.[1]).toBe("Try again");
    expect(sendAgentMessage.mock.calls[1]?.[1]).toBe("Try again");
  });

  it("passes selected model overrides to agent provisioning", async () => {
    let capturedOverrides:
      | { modelId?: string; providerId?: string }
      | undefined;

    const routes = createCellsRoutes(
      createDependencies({
        onEnsureAgentSession: (_cellId, _sessionId, overrides) => {
          capturedOverrides = overrides;
        },
      })
    );
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Model Override",
          templateId,
          workspaceId: "test-workspace",
          modelId: "custom-model",
          providerId: "zen",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as { id: string; status: string };
    expect(payload.status).toBe("spawning");

    await waitForCellStatus(payload.id, "ready");
    await waitForCondition(() => Boolean(capturedOverrides));

    expect(capturedOverrides).toEqual({
      modelId: "custom-model",
      providerId: "zen",
    });
  });

  it("skips sending the initial prompt when description is blank", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockResolvedValue(undefined);

    const routes = createCellsRoutes(
      createDependencies({
        sendAgentMessage,
      })
    );
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Blank Description",
          templateId,
          workspaceId: "test-workspace",
          description: "   ",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as { id: string; status: string };
    expect(payload.status).toBe("spawning");

    await waitForCellStatus(payload.id, "ready");
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});

describe("resumeSpawningCells", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("retries provisioning for stranded cells", async () => {
    const dependencies = createDependencies();
    const cellId = "resume-cell";
    const createdAt = new Date();

    await testDb.insert(cells).values({
      id: cellId,
      name: "Resume Cell",
      description: "Resume description",
      templateId,
      workspaceId: "test-workspace",
      workspacePath,
      workspaceRootPath: "/tmp/test-workspace-root",
      branchName: "cell-branch",
      baseCommit: "abc123",
      opencodeSessionId: null,
      opencodeServerUrl: null,
      opencodeServerPort: null,
      createdAt,
      status: "spawning" as const,
      phase: "implementation" as const,
      lastSetupError: null,
    });

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: null,
      providerIdOverride: null,
      attemptCount: 0,
      startedAt: null,
      finishedAt: null,
    });

    await resumeSpawningCells(dependencies);

    const readyRow = await waitForCellStatus(cellId, "ready");
    const [provisioningState] = await testDb
      .select()
      .from(cellProvisioningStates)
      .where(eq(cellProvisioningStates.cellId, cellId));

    expect(provisioningState?.startedAt).toBeInstanceOf(Date);
    expect(provisioningState?.finishedAt).toBeInstanceOf(Date);
    expect(provisioningState?.attemptCount).toBe(1);
    expect(readyRow.lastSetupError).toBeNull();
  });

  it("marks cells as error when the template no longer exists", async () => {
    const missingTemplateConfig: HiveConfig = {
      ...hiveConfig,
      templates: {},
    };

    const cellId = "missing-template-cell";
    await testDb.insert(cells).values({
      id: cellId,
      name: "Missing Template",
      templateId: "removed-template",
      workspaceId: "test-workspace",
      workspacePath,
      workspaceRootPath: "/tmp/test-workspace-root",
      createdAt: new Date(),
      status: "spawning" as const,
      phase: "implementation" as const,
    });

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: null,
      providerIdOverride: null,
      attemptCount: 0,
      startedAt: null,
      finishedAt: null,
    });

    await resumeSpawningCells(
      createDependencies({ hiveConfigOverride: missingTemplateConfig })
    );

    const errored = await waitForCellStatus(cellId, "error");
    expect(errored.lastSetupError).toContain(
      "Template removed-template no longer exists"
    );
  });
});

describe("cell archival", () => {
  const workspaceRecord = {
    id: "workspace-archive",
    label: "Archive Workspace",
    path: "/tmp/archive-workspace",
    addedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    await testDb.delete(cellServices);
    await testDb.delete(cells);
  });

  it("archives a cell and cleans up resources", async () => {
    const cellId = "archivable-cell";
    const closeSession = vi.fn((_cellId: string) => Effect.void);
    const stopServices = vi.fn(
      (_cellId: string, _options?: { releasePorts?: boolean }) => Effect.void
    );
    const removeWorktree = vi.fn(() => Effect.void);

    await testDb.insert(cells).values({
      id: cellId,
      name: "Archivable Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "ready" as const,
      phase: "implementation" as const,
    });

    const dependencies = {
      db: testDb,
      resolveWorkspaceContext: () =>
        Effect.succeed({
          workspace: workspaceRecord,
          loadConfig: () => Effect.succeed(hiveConfig),
          createWorktreeManager: () =>
            Effect.succeed({
              createWorktree: () => Effect.void,
              removeWorktree: () => removeWorktree(),
            }),
          createWorktree: () => Effect.void,
          removeWorktree: () => Effect.void,
        }),
      ensureAgentSession: () =>
        Effect.succeed({
          id: "session-archive",
          cellId,
          templateId,
          provider: "opencode",
          status: "awaiting_input",
          workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      sendAgentMessage: () => Effect.void,
      closeAgentSession: (id: string) => closeSession(id),
      ensureServicesForCell: () => Effect.void,
      startServicesForCell: () => Effect.void,
      startServiceById: () => Effect.void,
      stopServiceById: () => Effect.void,
      stopServicesForCell: (
        targetCellId: string,
        options?: { releasePorts?: boolean }
      ) => stopServices(targetCellId, options),
    };

    const app = new Elysia().use(createCellsRoutes(dependencies as any));

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/archive`, {
        method: "POST",
      })
    );

    expect(response.status).toBe(OK_STATUS);
    const payload = (await response.json()) as {
      status: string;
      workspacePath: string;
    };
    expect(payload.status).toBe("archived");
    expect(payload.workspacePath).toBe(workspacePath);

    expect(closeSession).toHaveBeenCalledWith(cellId);
    expect(stopServices).toHaveBeenCalledWith(cellId, { releasePorts: true });
    expect(removeWorktree).not.toHaveBeenCalled();

    const [row] = await testDb.select().from(cells).where(eq(cells.id, cellId));
    expect(row?.status).toBe("archived");
    expect(row?.workspacePath).toBe(workspacePath);
  });

  it("deletes archived cells and removes the worktree", async () => {
    const cellId = "archived-delete";
    await testDb.insert(cells).values({
      id: cellId,
      name: "Archived Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "archived",
    });

    const dependencies = createDependencies();
    const app = new Elysia().use(createCellsRoutes(dependencies));

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}`, {
        method: "DELETE",
      })
    );

    expect(response.status).toBe(OK_STATUS);
    expect(removeWorktreeCalls).toBe(1);

    const remaining = await testDb.select().from(cells);
    expect(remaining).toHaveLength(0);
  });

  it("requires cells to be archived before deletion", async () => {
    const cellId = "ready-delete";
    await testDb.insert(cells).values({
      id: cellId,
      name: "Ready Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "ready" as const,
      phase: "implementation" as const,
    });

    const app = new Elysia().use(createCellsRoutes(createDependencies()));

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}`, {
        method: "DELETE",
      })
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toContain("archived");

    const [row] = await testDb.select().from(cells).where(eq(cells.id, cellId));
    expect(row?.status).toBe("ready");
  });

  it("restores archived cells and restarts services", async () => {
    const cellId = "restore-cell";
    await testDb.insert(cells).values({
      id: cellId,
      name: "Archived Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "archived",
    });

    const ensureAgentSessionSpy = vi.fn();
    const dependencies = createDependencies({
      onEnsureAgentSession: ensureAgentSessionSpy,
    });
    const ensureServicesSpy = vi.fn();
    dependencies.ensureServicesForCell = (args: any) => {
      ensureServicesSpy(args);
      return Effect.void;
    };

    const app = new Elysia().use(createCellsRoutes(dependencies));

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/restore`, {
        method: "POST",
      })
    );

    expect(response.status).toBe(OK_STATUS);
    const payload = (await response.json()) as { status: string };
    expect(payload.status).toBe("ready");
    expect(ensureServicesSpy).toHaveBeenCalledTimes(1);
    expect(ensureAgentSessionSpy).toHaveBeenCalledWith(
      cellId,
      expect.any(String),
      expect.objectContaining({ force: true })
    );

    const [row] = await testDb.select().from(cells).where(eq(cells.id, cellId));
    expect(row?.status).toBe("ready");
  });

  it("rejects restore for active cells", async () => {
    const cellId = "restore-active";
    await testDb.insert(cells).values({
      id: cellId,
      name: "Ready Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "ready",
    });

    const app = new Elysia().use(createCellsRoutes(createDependencies()));

    const response = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/restore`, {
        method: "POST",
      })
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
    const payload = (await response.json()) as { message: string };
    expect(payload.message.toLowerCase()).toContain("not archived");

    const [row] = await testDb.select().from(cells).where(eq(cells.id, cellId));
    expect(row?.status).toBe("ready");
  });

  it("prevents service start for archived cells", async () => {
    const cellId = "archived-start";
    const serviceId = "service-1";
    const startService = vi.fn((_serviceId: string) => Effect.void);
    const closeSession = vi.fn((_cellId: string) => Effect.void);
    const stopServices = vi.fn(
      (_cellId: string, _options?: { releasePorts?: boolean }) => Effect.void
    );
    const removeWorktree = vi.fn((_cellId: string) => Effect.void);
    const createdAt = new Date();

    await testDb.insert(cells).values({
      id: cellId,
      name: "Archived Cell",
      templateId,
      workspaceId: workspaceRecord.id,
      workspacePath,
      workspaceRootPath: workspaceRecord.path,
      branchName: "cell-branch",
      baseCommit: "abc123",
      createdAt: new Date(),
      status: "archived" as const,
      phase: "implementation" as const,
    });

    await testDb.insert(cellServices).values({
      id: serviceId,
      cellId,
      name: "web",
      type: "process",
      command: "npm start",
      cwd: "/tmp",
      env: {},
      status: "stopped",
      definition: { type: "process", run: "npm start", cwd: "/tmp" },
      createdAt,
      updatedAt: createdAt,
    });

    const baseDeps = createDependencies();
    const dependencies = {
      ...baseDeps,
      resolveWorkspaceContext: () =>
        Effect.succeed({
          workspace: workspaceRecord,
          loadConfig: () => Effect.succeed(hiveConfig),
          createWorktreeManager: () =>
            Effect.succeed({
              createWorktree: (_cellId: string) =>
                Effect.succeed({
                  path: workspacePath,
                  branch: "cell-branch",
                  baseCommit: "abc123",
                }),
              removeWorktree: (_cellId: string) => removeWorktree(_cellId),
            }),
          createWorktree: (_cellId: string) =>
            Effect.succeed({
              path: workspacePath,
              branch: "cell-branch",
              baseCommit: "abc123",
            }),
          removeWorktree: (_cellId: string) => removeWorktree(_cellId),
        }),
      ensureAgentSession: () =>
        Effect.succeed({
          id: "session-archive",
          cellId,
          templateId,
          provider: "opencode",
          status: "awaiting_input",
          workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      sendAgentMessage: () => Effect.void,
      closeAgentSession: (id: string) => closeSession(id),
      ensureServicesForCell: () => Effect.void,
      startServicesForCell: () => Effect.void,
      startServiceById: (requestedServiceId: string) =>
        startService(requestedServiceId),
      stopServiceById: (_serviceId: string) => Effect.void,
      stopServicesForCell: (
        targetCellId: string,
        options?: { releasePorts?: boolean }
      ) => stopServices(targetCellId, options),
    };

    const app = new Elysia().use(createCellsRoutes(dependencies as any));

    const response = await app.handle(
      new Request(
        `http://localhost/api/cells/${cellId}/services/${serviceId}/start`,
        {
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(BAD_REQUEST_STATUS);
    const payload = (await response.json()) as { message: string };
    expect(payload.message.toLowerCase()).toContain("archived");
    expect(startService).not.toHaveBeenCalled();
  });
});
