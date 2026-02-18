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
const CELLS_API_URL = "http://localhost/api/cells";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

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

function makeJsonPostRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

function postCreateCell(
  app: Elysia,
  body: Record<string, unknown>
): Promise<Response> {
  return app.handle(makeJsonPostRequest(CELLS_API_URL, body));
}

function postSetupRetry(app: Elysia, cellId: string): Promise<Response> {
  return app.handle(
    new Request(`${CELLS_API_URL}/${cellId}/setup/retry`, {
      method: "POST",
    })
  );
}

function deleteCellById(app: Elysia, cellId: string): Promise<Response> {
  return app.handle(
    new Request(`${CELLS_API_URL}/${cellId}`, {
      method: "DELETE",
    })
  );
}

async function insertCellRow(
  values: Partial<typeof cells.$inferInsert> & {
    id: string;
    name: string;
  }
) {
  await testDb.insert(cells).values({
    templateId,
    workspaceId: "test-workspace",
    workspacePath,
    workspaceRootPath: "/tmp/test-workspace-root",
    branchName: "cell-branch",
    baseCommit: "abc123",
    opencodeSessionId: null,
    createdAt: new Date(),
    status: "ready",
    lastSetupError: null,
    ...values,
  });
}

async function insertProvisioningStateRow(
  cellId: string,
  values: Partial<typeof cellProvisioningStates.$inferInsert> = {}
) {
  await testDb.insert(cellProvisioningStates).values({
    cellId,
    modelIdOverride: null,
    providerIdOverride: null,
    attemptCount: 0,
    startedAt: null,
    finishedAt: null,
    ...values,
  });
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

function createTestApp(options: DependencyFactoryOptions = {}) {
  return new Elysia().use(createCellsRoutes(createDependencies(options)));
}

async function createCellAndExpectSpawning(args: {
  app: Elysia;
  body: Record<string, unknown>;
}) {
  const response = await postCreateCell(args.app, args.body);

  if (response.status !== CREATED_STATUS) {
    throw new Error(
      `Expected status ${CREATED_STATUS}, got ${response.status}`
    );
  }

  const payload = (await response.json()) as {
    id: string;
    status: string;
    lastSetupError?: string;
  };
  if (payload.status !== "spawning") {
    throw new Error(`Expected status spawning, got ${payload.status}`);
  }

  return payload;
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

    const app = createTestApp({ setupError });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Broken Cell",
        templateId,
        workspaceId: "test-workspace",
      },
    });

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

    const app = createTestApp({
      sendAgentMessage,
      onEnsureAgentSession: (_cellId, sessionId) => {
        capturedSessionId = sessionId;
      },
    });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Autostart Cell",
        templateId,
        workspaceId: "test-workspace",
        description: "  Fix the failing specs in apps/web  ",
      },
    });

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

    const app = createTestApp({
      onEnsureAgentSession: (_cellId, _sessionId, overrides) => {
        capturedOverrides = overrides;
      },
    });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Model Override",
        templateId,
        workspaceId: "test-workspace",
        modelId: "custom-model",
        providerId: "zen",
      },
    });

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

    const app = createTestApp({ sendAgentMessage });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Blank Description",
        templateId,
        workspaceId: "test-workspace",
        description: "   ",
      },
    });

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

    const app = createTestApp({ createWorktree });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Streaming Worktree Timing",
        templateId,
        workspaceId: "test-workspace",
      },
    });

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

  it("cancels provisioning when the cell enters deleting state", async () => {
    let releaseWorktree = () => {
      // replaced below once deferred promise is created
    };
    const createWorktree: CreateWorktreeFn = async () => {
      await new Promise<void>((resolve) => {
        releaseWorktree = resolve;
      });

      return {
        path: workspacePath,
        branch: "cell-branch",
        baseCommit: "abc123",
      };
    };
    const ensureServicesForCell = vi.fn(async () => Promise.resolve());

    const app = createTestApp({
      createWorktree,
      ensureServicesForCell,
    });

    const payload = await createCellAndExpectSpawning({
      app,
      body: {
        name: "Cancel During Delete",
        templateId,
        workspaceId: "test-workspace",
      },
    });

    const deleteResponse = await deleteCellById(app, payload.id);
    expect(deleteResponse.status).toBe(OK_STATUS);

    releaseWorktree();

    await waitForCondition(async () => {
      const rows = await testDb
        .select({ id: cells.id })
        .from(cells)
        .where(eq(cells.id, payload.id));
      return rows.length === 0;
    });

    expect(ensureServicesForCell).not.toHaveBeenCalled();
  });
});

describe("POST /api/cells/:id/setup/retry", () => {
  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("does not resend the initial prompt when retrying an existing session", async () => {
    const sendAgentMessage = vi
      .fn<SendAgentMessageFn>()
      .mockResolvedValue(undefined);
    const app = createTestApp({ sendAgentMessage });
    const cellId = "retry-existing-session-cell";

    await insertCellRow({
      id: cellId,
      name: "Retry Existing Session",
      description: "Repeat-safe prompt",
      opencodeSessionId: "session-retry-existing-session-cell",
      status: "error",
      lastSetupError: "setup failed",
    });

    await insertProvisioningStateRow(cellId, {
      attemptCount: 1,
    });

    const retryResponse = await postSetupRetry(app, cellId);
    expect(retryResponse.status).toBe(OK_STATUS);

    await waitForCellStatus(cellId, "ready");
    expect(sendAgentMessage).not.toHaveBeenCalled();
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

    const app = createTestApp({ ensureServicesForCell });
    const cellId = "retry-lock-cell";

    await insertCellRow({
      id: cellId,
      name: "Retry Lock Cell",
      description: "Retry lock",
      status: "error",
      lastSetupError: "Setup failed",
    });

    await insertProvisioningStateRow(cellId);

    const firstRetryPromise = postSetupRetry(app, cellId);

    await waitForCondition(() => ensureServicesForCell.mock.calls.length === 1);

    const secondRetryResponse = await postSetupRetry(app, cellId);
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

    await insertCellRow({
      id: cellId,
      name: "Resume Cell",
      description: "Resume description",
      createdAt,
      status: "spawning",
    });

    await insertProvisioningStateRow(cellId);

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
    await insertCellRow({
      id: cellId,
      name: "Missing Template",
      templateId: "removed-template",
      status: "spawning",
    });

    await insertProvisioningStateRow(cellId);

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

    await insertCellRow({
      id: cellId,
      name: "Deleting Cell",
      description: "Interrupted deletion",
      status: "deleting",
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
