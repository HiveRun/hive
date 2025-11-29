import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
    setupError: TemplateSetupError
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

    return {
      db: testDb,
      resolveWorkspaceContext: async () => ({
        workspace: workspaceRecord,
        loadConfig: loadWorkspaceConfig,
        createWorktreeManager: createTestWorktreeManager,
      }),
      ensureAgentSession: (cellId: string) =>
        Promise.resolve<AgentSessionRecord>({
          id: `session-${cellId}`,
          cellId,
          templateId,
          provider: "opencode",
          status: "awaiting_input",
          workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      closeAgentSession: (_cellId: string) => Promise.resolve(),
      ensureServicesForCell: (_args?: unknown) => Promise.reject(setupError),
      stopServicesForCell: (
        _cellId: string,
        _options?: { releasePorts?: boolean }
      ) => Promise.resolve(),
      startServiceById: (_serviceId: string) => Promise.resolve(),
      stopServiceById: (_serviceId: string) => Promise.resolve(),
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

    const routes = createCellsRoutes(createDependencies(setupError));
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
});
