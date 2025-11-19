import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../agents/types";
import type { SyntheticConfig } from "../../config/schema";
import {
  type ConstructRouteDependencies,
  createConstructsRoutes,
} from "../../routes/constructs";
import { constructs } from "../../schema/constructs";
import {
  CommandExecutionError,
  TemplateSetupError,
} from "../../services/supervisor";
import { setupTestDb, testDb } from "../test-db";

const templateId = "failing-template";
const workspacePath = "/tmp/mock-worktree";
const CREATED_STATUS = 201;

const syntheticConfig: SyntheticConfig = {
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

describe("POST /api/constructs", () => {
  let removeWorktreeCalls = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(constructs);
    removeWorktreeCalls = 0;
  });

  function createDependencies(
    setupError: TemplateSetupError
  ): Partial<ConstructRouteDependencies> {
    const workspaceRecord = {
      id: "test-workspace",
      label: "Test Workspace",
      path: "/tmp/test-workspace-root",
      addedAt: new Date().toISOString(),
    };

    return {
      db: testDb,
      resolveWorkspaceContext: async () => ({
        workspace: workspaceRecord,
        loadConfig: () => Promise.resolve(syntheticConfig),
        createWorktreeManager: async () => ({
          createWorktree(_constructId: string) {
            return Promise.resolve({
              path: workspacePath,
              branch: "construct-branch",
              baseCommit: "abc123",
            });
          },
          removeWorktree(_constructId: string) {
            removeWorktreeCalls += 1;
          },
        }),
      }),
      ensureAgentSession: (constructId: string) =>
        Promise.resolve<AgentSessionRecord>({
          id: `session-${constructId}`,
          constructId,
          templateId,
          provider: "opencode",
          status: "awaiting_input",
          workspacePath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      closeAgentSession: (_constructId: string) => Promise.resolve(),
      ensureServicesForConstruct: (_args?: unknown) =>
        Promise.reject(setupError),
      stopServicesForConstruct: (
        _constructId: string,
        _options?: { releasePorts?: boolean }
      ) => Promise.resolve(),
      startServiceById: (_serviceId: string) => Promise.resolve(),
      stopServiceById: (_serviceId: string) => Promise.resolve(),
    } satisfies Partial<ConstructRouteDependencies>;
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

    const routes = createConstructsRoutes(createDependencies(setupError));
    const app = new Elysia().use(routes);

    const response = await app.handle(
      new Request("http://localhost/api/constructs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Broken Construct",
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

    const rows = await testDb.select().from(constructs);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.status).toBe("error");
    expect(row?.lastSetupError).toContain("exit code 42");
  });
});
