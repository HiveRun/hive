// @ts-nocheck
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { HiveConfig } from "../../config/schema";
import { createCellsRoutes, resumeSpawningCells } from "../../routes/cells";

import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import { cellTimingEvents } from "../../schema/timing-events";
import type { ServiceSupervisorError } from "../../services/supervisor";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const OK_STATUS = 200;
const CREATED_STATUS = 201;
const CONFLICT_STATUS = 409;
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

async function waitForTimingStep(cellId: string, step: string) {
  let found: typeof cellTimingEvents.$inferSelect | undefined;
  await waitForCondition(async () => {
    const rows = await testDb
      .select()
      .from(cellTimingEvents)
      .where(eq(cellTimingEvents.cellId, cellId));
    found = rows.find((row) => row.step === step);
    return Boolean(found);
  });

  if (!found) {
    throw new Error(`Timing step ${step} not found for ${cellId}`);
  }

  return found;
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
type EnsureServicesForCellFn = (args: unknown) => Promise<void>;
type CreateWorktreeFn = (
  cellId: string,
  options?: {
    templateId?: string;
    force?: boolean;
    onTimingEvent?: (event: {
      step: string;
      durationMs: number;
      metadata?: Record<string, unknown>;
    }) => void;
  }
) => Promise<{
  path: string;
  branch: string;
  baseCommit: string;
}>;

type DependencyFactoryOptions = {
  setupError?: TemplateSetupError;
  sendAgentMessage?: SendAgentMessageFn;
  ensureServicesForCell?: EnsureServicesForCellFn;
  createWorktree?: CreateWorktreeFn;
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

  const buildWorktree = (
    cellId: string,
    createOptions?: Parameters<CreateWorktreeFn>[1]
  ) =>
    Promise.resolve({
      path: workspacePath,
      branch: "cell-branch",
      baseCommit: "abc123",
    }).then((defaultWorktree) => {
      if (options.createWorktree) {
        return options.createWorktree(cellId, createOptions);
      }
      return defaultWorktree;
    });

  const removeWorktreeCall = () =>
    Promise.resolve().then(() => {
      removeWorktreeCalls += 1;
    });

  const sendAgentMessageImpl =
    options.sendAgentMessage ?? vi.fn<SendAgentMessageFn>().mockResolvedValue();

  return {
    db: testDb,
    resolveWorkspaceContext: (async () => ({
      workspace: workspaceRecord,
      loadConfig: loadWorkspaceConfig,
      createWorktreeManager: async () => ({
        createWorktree: (
          cellId: string,
          createOptions?: Parameters<CreateWorktreeFn>[1]
        ) => buildWorktree(cellId, createOptions),
        removeWorktree: (_cellId: string) => removeWorktreeCall(),
      }),
      createWorktree: (
        cellId: string,
        createOptions?: Parameters<CreateWorktreeFn>[1]
      ) => buildWorktree(cellId, createOptions),
      removeWorktree: (_cellId: string) => removeWorktreeCall(),
    })) as any,

    ensureAgentSession: (
      cellId: string,
      overrides?: { modelId?: string; providerId?: string }
    ) =>
      Promise.resolve().then(() => {
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
    closeAgentSession: async (_cellId: string) => Promise.resolve(),
    ensureServicesForCell: (_args: any) => {
      if (options.ensureServicesForCell) {
        return options.ensureServicesForCell(_args);
      }
      if (options.setupError) {
        throw {
          _tag: "ServiceSupervisorError",
          cause: options.setupError,
        } as ServiceSupervisorError;
      }
      return Promise.resolve();
    },
    startServicesForCell: async (_cellId: string) => Promise.resolve(),
    stopServicesForCell: (
      _cellId: string,
      _options?: { releasePorts?: boolean }
    ) => Promise.resolve(),
    startServiceById: (_serviceId: string) => Promise.resolve(),
    stopServiceById: (
      _serviceId: string,
      _options?: { releasePorts?: boolean }
    ) => Promise.resolve(),
    sendAgentMessage: (sessionId: string, content: string) =>
      sendAgentMessageImpl(sessionId, content),
    ensureTerminalSession: ({ cellId }) => ({
      sessionId: `terminal-${cellId}`,
      cellId,
      pid: 123,
      cwd: workspacePath,
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

  it("persists create_worktree timing sub-steps while provisioning is still running", async () => {
    let releaseWorktree = () => {
      // replaced when deferred worktree promise is created
    };

    const createWorktree: CreateWorktreeFn = async (_cellId, createOptions) => {
      createOptions?.onTimingEvent?.({
        step: "include_copy_glob_match_start",
        durationMs: 0,
      });

      await new Promise<void>((resolve) => {
        releaseWorktree = resolve;
      });

      createOptions?.onTimingEvent?.({
        step: "include_copy_glob_match",
        durationMs: 15,
      });

      return {
        path: workspacePath,
        branch: "cell-branch",
        baseCommit: "abc123",
      };
    };

    const routes = createCellsRoutes(createDependencies({ createWorktree }));
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Streaming Worktree Timing",
          templateId,
          workspaceId: "test-workspace",
        }),
      })
    );

    expect(response.status).toBe(CREATED_STATUS);
    const payload = (await response.json()) as { id: string; status: string };
    expect(payload.status).toBe("spawning");

    await waitForTimingStep(
      payload.id,
      "create_worktree:include_copy_glob_match_start"
    );

    const timingRowsBeforeRelease = await testDb
      .select()
      .from(cellTimingEvents)
      .where(eq(cellTimingEvents.cellId, payload.id));
    expect(
      timingRowsBeforeRelease.some(
        (row) => row.step === "create_worktree:include_copy_glob_match"
      )
    ).toBe(false);

    releaseWorktree();

    await waitForTimingStep(
      payload.id,
      "create_worktree:include_copy_glob_match"
    );
    await waitForCellStatus(payload.id, "ready");
  });
});

describe("POST /api/cells/:id/setup/retry", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("returns 409 when a retry is already in progress", async () => {
    let releaseEnsureServices = () => {
      // replaced below once the deferred promise is created
    };
    const ensureServicesForCell = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseEnsureServices = resolve;
      });
    });

    const routes = createCellsRoutes(
      createDependencies({ ensureServicesForCell })
    );
    const app = new Elysia().use(routes);
    const cellId = "retry-lock-cell";

    await testDb.insert(cells).values({
      id: cellId,
      name: "Retry Lock Cell",
      description: "Retry lock",
      templateId,
      workspaceId: "test-workspace",
      workspacePath,
      workspaceRootPath: "/tmp/test-workspace-root",
      branchName: "cell-branch",
      baseCommit: "abc123",
      opencodeSessionId: null,
      createdAt: new Date(),
      status: "error",
      lastSetupError: "Setup failed",
    });

    await testDb.insert(cellProvisioningStates).values({
      cellId,
      modelIdOverride: null,
      providerIdOverride: null,
      attemptCount: 0,
      startedAt: null,
      finishedAt: null,
    });

    const firstRetryPromise = app.handle(
      new Request(`http://localhost/api/cells/${cellId}/setup/retry`, {
        method: "POST",
      })
    );

    await waitForCondition(() => ensureServicesForCell.mock.calls.length === 1);

    const secondRetryResponse = await app.handle(
      new Request(`http://localhost/api/cells/${cellId}/setup/retry`, {
        method: "POST",
      })
    );
    expect(secondRetryResponse.status).toBe(CONFLICT_STATUS);
    expect((await secondRetryResponse.json()) as { message: string }).toEqual({
      message: "Provisioning retry already in progress",
    });

    releaseEnsureServices();

    const firstRetryResponse = await firstRetryPromise;
    expect(firstRetryResponse.status).toBe(OK_STATUS);
    await waitForCellStatus(cellId, "ready");
  });
});

describe("resumeSpawningCells", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
    removeWorktreeCalls = 0;
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
      createdAt,
      status: "spawning",
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
      status: "spawning",
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

  it("resumes deleting cells left behind by interrupted shutdowns", async () => {
    const dependencies = createDependencies();
    const cellId = "stuck-deleting-cell";

    await testDb.insert(cells).values({
      id: cellId,
      name: "Deleting Cell",
      description: "Interrupted deletion",
      templateId,
      workspaceId: "test-workspace",
      workspacePath,
      workspaceRootPath: "/tmp/test-workspace-root",
      branchName: "cell-branch",
      baseCommit: "abc123",
      opencodeSessionId: null,
      createdAt: new Date(),
      status: "deleting",
      lastSetupError: null,
    });

    await resumeSpawningCells(dependencies);

    const remaining = await testDb
      .select({ id: cells.id })
      .from(cells)
      .where(eq(cells.id, cellId));

    expect(remaining).toHaveLength(0);
    expect(removeWorktreeCalls).toBe(1);
  });
});
