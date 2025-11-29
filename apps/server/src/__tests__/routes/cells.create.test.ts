import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { HiveConfig } from "../../config/schema";
import {
  type CellRouteDependencies,
  createCellsRoutes,
} from "../../routes/cells";
import { cells } from "../../schema/cells";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const CREATED_STATUS = 201;

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
};

describe("POST /api/cells", () => {
  let removeWorktreeCalls = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
    removeWorktreeCalls = 0;
  });

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
      return Promise.resolve(hiveConfig);
    }

    function createCellWorktree(_cellId: string) {
      return Promise.resolve({
        path: workspacePath,
        branch: "cell-branch",
        baseCommit: "abc123",
      });
    }

    function removeCellWorktree(_cellId: string) {
      removeWorktreeCalls += 1;
      return Promise.resolve();
    }

    function createTestWorktreeManager() {
      return Promise.resolve({
        createWorktree: createCellWorktree,
        removeWorktree: removeCellWorktree,
      });
    }

    const sendAgentMessageImpl =
      options.sendAgentMessage ??
      vi.fn<SendAgentMessageFn>().mockResolvedValue();

    return {
      db: testDb,
      resolveWorkspaceContext: async () => ({
        workspace: workspaceRecord,
        loadConfig: loadWorkspaceConfig,
        createWorktreeManager: createTestWorktreeManager,
      }),
      ensureAgentSession: (
        cellId: string,
        overrides?: { modelId?: string; providerId?: string }
      ) => {
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
        return Promise.resolve(session);
      },
      closeAgentSession: (_cellId: string) => Promise.resolve(),
      ensureServicesForCell: (_args?: unknown) =>
        options.setupError
          ? Promise.reject(options.setupError)
          : Promise.resolve(),
      stopServicesForCell: (
        _cellId: string,
        _options?: { releasePorts?: boolean }
      ) => Promise.resolve(),
      startServiceById: (_serviceId: string) => Promise.resolve(),
      stopServiceById: (_serviceId: string) => Promise.resolve(),
      sendAgentMessage: sendAgentMessageImpl,
    } satisfies Partial<CellRouteDependencies>;
  }

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

    expect(payload.status).toBe("error");
    expect(payload.lastSetupError).toBeTruthy();
    expect(payload.lastSetupError?.toLowerCase()).toContain("exit code 42");

    expect(removeWorktreeCalls).toBe(0);

    const rows = await testDb.select().from(cells);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.status).toBe("error");
    expect(row?.lastSetupError).toContain("exit code 42");
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
    expect(capturedSessionId).toBeTruthy();
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
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
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
