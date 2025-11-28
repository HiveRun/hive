import { Elysia } from "elysia";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HiveConfig } from "../../config/schema";
import { createConstructsRoutes } from "../../routes/constructs";
import { constructs } from "../../schema/constructs";
import type { WorkspaceRecord } from "../../workspaces/registry";
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

describe("Construct routes workspace enforcement", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await testDb.delete(constructs);
  });

  it("returns 400 when workspace context cannot be resolved", async () => {
    const app = new Elysia().use(
      createConstructsRoutes({
        db: testDb,
        resolveWorkspaceContext: () =>
          Promise.reject(
            new Error(
              "No active workspace. Register and activate a workspace to continue."
            )
          ),
      })
    );

    const listResponse = await app.handle(
      new Request("http://localhost/api/constructs")
    );

    expect(listResponse.status).toBe(HTTP_BAD_REQUEST);
    const listPayload = (await listResponse.json()) as { message: string };
    expect(listPayload.message.toLowerCase()).toContain("workspace");

    const createResponse = await app.handle(
      new Request("http://localhost/api/constructs", {
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

  it("filters construct listings by workspace id", async () => {
    const now = new Date();
    await testDb.insert(constructs).values([
      {
        id: "construct-primary",
        name: "Primary construct",
        description: "From primary workspace",
        templateId: "test-template",
        workspaceId: primaryWorkspace.id,
        workspaceRootPath: primaryWorkspace.path,
        workspacePath: `${primaryWorkspace.path}/.hive/constructs/primary`,
        branchName: "feature/x",
        baseCommit: "abc123",
        createdAt: now,
        status: "ready",
      },
      {
        id: "construct-secondary",
        name: "Secondary construct",
        description: "From secondary workspace",
        templateId: "test-template",
        workspaceId: secondaryWorkspace.id,
        workspaceRootPath: secondaryWorkspace.path,
        workspacePath: `${secondaryWorkspace.path}/.hive/constructs/secondary`,
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
        return Promise.reject(
          new Error(`Workspace '${workspaceId}' not found`)
        );
      }

      return Promise.resolve({
        workspace: resolved,
        loadConfig: () => Promise.resolve(hiveConfig),
        createWorktreeManager: async () => ({
          createWorktree: async () => ({
            path: `${resolved.path}/.hive/constructs/new`,
            branch: "main",
            baseCommit: "base",
          }),
          removeWorktree: async () => {
            /* noop for tests */
          },
        }),
      });
    };

    const app = new Elysia().use(
      createConstructsRoutes({
        db: testDb,
        resolveWorkspaceContext,
      })
    );

    const primaryResponse = await app.handle(
      new Request(
        `http://localhost/api/constructs?workspaceId=${primaryWorkspace.id}`
      )
    );
    expect(primaryResponse.status).toBe(HTTP_OK);
    const primaryPayload = (await primaryResponse.json()) as {
      constructs: Array<{ id: string }>;
    };
    expect(primaryPayload.constructs).toHaveLength(1);
    expect(primaryPayload.constructs[0]?.id).toBe("construct-primary");

    const secondaryResponse = await app.handle(
      new Request(
        `http://localhost/api/constructs?workspaceId=${secondaryWorkspace.id}`
      )
    );
    expect(secondaryResponse.status).toBe(HTTP_OK);
    const secondaryPayload = (await secondaryResponse.json()) as {
      constructs: Array<{ id: string }>;
    };
    expect(secondaryPayload.constructs).toHaveLength(1);
    expect(secondaryPayload.constructs[0]?.id).toBe("construct-secondary");
  });
});
