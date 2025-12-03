import { Effect } from "effect";
import { Elysia } from "elysia";
import { okAsync } from "neverthrow";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HiveConfig } from "../../config/schema";
import { createCellsRoutes } from "../../routes/cells";
import { cells } from "../../schema/cells";
import { WorkspaceContextError } from "../../workspaces/context";
import type { WorkspaceRecord } from "../../workspaces/registry";
import type { WorktreeManager } from "../../worktree/manager";
import { setupTestDb, testDb } from "../test-db";

const HTTP_BAD_REQUEST = 400;
const HTTP_OK = 200;

const hiveConfig: HiveConfig = {
  opencode: {
    defaultProvider: "opencode",
    defaultModel: "big-pickle",
  },
  promptSources: [],
  templates: {
    "test-template": {
      id: "test-template",
      label: "Test Template",
      type: "manual",
    },
  },
  defaults: {},
};

const primaryWorkspace: WorkspaceRecord = {
  id: "workspace-primary",
  label: "Primary",
  path: "/tmp/workspaces/primary",
  addedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
};

const secondaryWorkspace: WorkspaceRecord = {
  id: "workspace-secondary",
  label: "Secondary",
  path: "/tmp/workspaces/secondary",
  addedAt: new Date("2024-01-02T00:00:00Z").toISOString(),
};

describe("Cell routes workspace enforcement", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(cells);
  });

  it("returns 400 when workspace context cannot be resolved", async () => {
    const app = new Elysia().use(
      createCellsRoutes({
        db: testDb,
        resolveWorkspaceContext: () =>
          Effect.fail(
            new WorkspaceContextError(
              "No active workspace. Register and activate a workspace to continue."
            )
          ),
      })
    );

    const listResponse = await app.handle(
      new Request("http://localhost/api/cells")
    );

    expect(listResponse.status).toBe(HTTP_BAD_REQUEST);
    const listPayload = (await listResponse.json()) as { message: string };
    expect(listPayload.message.toLowerCase()).toContain("workspace");

    const createResponse = await app.handle(
      new Request("http://localhost/api/cells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "No Workspace",
          templateId: "test-template",
          workspaceId: "missing",
        }),
      })
    );

    expect(createResponse.status).toBe(HTTP_BAD_REQUEST);
    const createPayload = (await createResponse.json()) as { message: string };
    expect(createPayload.message.toLowerCase()).toContain("workspace");
  });

  it("filters cell listings by workspace id", async () => {
    const now = new Date();
    await testDb.insert(cells).values([
      {
        id: "cell-primary",
        name: "Primary cell",
        description: "From primary workspace",
        templateId: "test-template",
        workspaceId: primaryWorkspace.id,
        workspaceRootPath: primaryWorkspace.path,
        workspacePath: `${primaryWorkspace.path}/.hive/cells/primary`,
        branchName: "feature/x",
        baseCommit: "abc123",
        createdAt: now,
        status: "ready",
      },
      {
        id: "cell-secondary",
        name: "Secondary cell",
        description: "From secondary workspace",
        templateId: "test-template",
        workspaceId: secondaryWorkspace.id,
        workspaceRootPath: secondaryWorkspace.path,
        workspacePath: `${secondaryWorkspace.path}/.hive/cells/secondary`,
        branchName: "feature/y",
        baseCommit: "def456",
        createdAt: now,
        status: "ready",
      },
    ]);

    const resolveWorkspaceContext = (workspaceId?: string) => {
      const registry: Record<string, WorkspaceRecord> = {
        [primaryWorkspace.id]: primaryWorkspace,
        [secondaryWorkspace.id]: secondaryWorkspace,
      };
      const resolved = workspaceId ? registry[workspaceId] : primaryWorkspace;
      if (!resolved) {
        return Effect.fail(
          new WorkspaceContextError(`Workspace '${workspaceId}' not found`)
        );
      }

      const mockManager: WorktreeManager = {
        createWorktree: () =>
          okAsync({
            path: `${resolved.path}/.hive/cells/new`,
            branch: "main",
            baseCommit: "base",
          }),
        removeWorktree: () => okAsync(undefined),
      };

      return Effect.succeed({
        workspace: resolved,
        loadConfig: () => Effect.succeed(hiveConfig),
        createWorktreeManager: () => Effect.succeed(mockManager),
        createWorktree: () =>
          Effect.succeed({
            path: `${resolved.path}/.hive/cells/new`,
            branch: "main",
            baseCommit: "base",
          }),
        removeWorktree: () => Effect.void,
      });
    };

    const app = new Elysia().use(
      createCellsRoutes({
        db: testDb,
        resolveWorkspaceContext,
      })
    );

    const primaryResponse = await app.handle(
      new Request(
        `http://localhost/api/cells?workspaceId=${primaryWorkspace.id}`
      )
    );
    expect(primaryResponse.status).toBe(HTTP_OK);
    const primaryPayload = (await primaryResponse.json()) as {
      cells: Array<{ id: string }>;
    };
    expect(primaryPayload.cells).toHaveLength(1);
    expect(primaryPayload.cells[0]?.id).toBe("cell-primary");

    const secondaryResponse = await app.handle(
      new Request(
        `http://localhost/api/cells?workspaceId=${secondaryWorkspace.id}`
      )
    );
    expect(secondaryResponse.status).toBe(HTTP_OK);
    const secondaryPayload = (await secondaryResponse.json()) as {
      cells: Array<{ id: string }>;
    };
    expect(secondaryPayload.cells).toHaveLength(1);
    expect(secondaryPayload.cells[0]?.id).toBe("cell-secondary");
  });
});
