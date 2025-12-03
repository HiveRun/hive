import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Elysia } from "elysia";
import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { HiveConfig } from "../../config/schema";
import {
  type CellRouteDependencies,
  createCellsRoutes,
  resumeSpawningCells,
} from "../../routes/cells";
import { cellProvisioningStates } from "../../schema/cell-provisioning";
import { cells } from "../../schema/cells";
import type { ServiceSupervisorError } from "../../services/supervisor";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const CREATED_STATUS = 201;
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

function createDependencies(
  options: DependencyFactoryOptions = {}
): Partial<CellRouteDependencies> {
  const workspaceRecord = {
    id: "test-workspace",
    label: "Test Workspace",
    path: "/tmp/test-workspace-root",
    addedAt: new Date().toISOString(),
  };

  function loadWorkspaceConfig() {
    return Promise.resolve(options.hiveConfigOverride ?? hiveConfig);
  }

  function createCellWorktree(_cellId: string) {
    return okAsync({
      path: workspacePath,
      branch: "cell-branch",
      baseCommit: "abc123",
    });
  }

  function removeCellWorktree(_cellId: string) {
    removeWorktreeCalls += 1;
    return okAsync(undefined);
  }

  const sendAgentMessageImpl =
    options.sendAgentMessage ?? vi.fn<SendAgentMessageFn>().mockResolvedValue();

  return {
    db: testDb,
    resolveWorkspaceContext: () =>
      Effect.succeed({
        workspace: workspaceRecord,
        loadConfig: () => Effect.promise(loadWorkspaceConfig),
        createWorktreeManager: () =>
          Effect.succeed({
            createWorktree: createCellWorktree,
            removeWorktree: removeCellWorktree,
          }),
        createWorktree: () =>
          Effect.succeed({
            path: workspacePath,
            branch: "cell-branch",
            baseCommit: "abc123",
          }),
        removeWorktree: () =>
          Effect.sync(() => {
            removeWorktreeCalls += 1;
          }),
      }),

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
    ensureServicesForCell: (
      _args: Parameters<CellRouteDependencies["ensureServicesForCell"]>[0]
    ) =>
      options.setupError
        ? Effect.fail({
            _tag: "ServiceSupervisorError",
            cause: options.setupError,
          } as ServiceSupervisorError)
        : Effect.void,
    stopServicesForCell: (
      _cellId: string,
      _options?: { releasePorts?: boolean }
    ) => Effect.void,
    startServiceById: (_serviceId: string) => Effect.void,
    stopServiceById: (
      _serviceId: string,
      _options?: { releasePorts?: boolean }
    ) => Effect.void,
    sendAgentMessage: (sessionId, content) =>
      Effect.promise(() => sendAgentMessageImpl(sessionId, content)),
  } satisfies Partial<CellRouteDependencies>;
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
});
