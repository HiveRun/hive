import { Database } from "bun:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Elysia } from "elysia";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as LinearClientModule from "../../linear/client";
import {
  readStoredLinearSecret,
  storeLinearSecret,
} from "../../linear/token-crypto";
import { createLinearRoutes } from "../../routes/linear";
import { schema } from "../../schema";
import { linearIntegrations } from "../../schema/linear-integrations";
import type {
  ResolveWorkspaceContext,
  WorkspaceRuntimeContext,
} from "../../workspaces/context";

const JSON_HEADERS = {
  "content-type": "application/json",
  origin: "http://localhost:3001",
};

const WORKSPACE = {
  id: "workspace-linear-test",
  label: "Linear Test Workspace",
  path: "/tmp/linear-workspace",
  addedAt: new Date("2025-01-01T00:00:00Z").toISOString(),
};

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NO_CONTENT = 204;
const HTTP_INTERNAL_ERROR = 500;
const sqlite = new Database(":memory:");
const linearTestDb = drizzle(sqlite, { schema });

const resolveWorkspaceContext: ResolveWorkspaceContext = (workspaceId) => {
  if (workspaceId && workspaceId !== WORKSPACE.id) {
    throw new Error(`Workspace '${workspaceId}' not found`);
  }

  return Promise.resolve({
    workspace: WORKSPACE,
    loadConfig: () => Promise.resolve({ promptSources: [], templates: {} }),
    createWorktreeManager: () =>
      Promise.reject(new Error("Not implemented in linear route tests")),
    createWorktree: () =>
      Promise.reject(new Error("Not implemented in linear route tests")),
    removeWorktree: () => Promise.resolve(),
  } satisfies WorkspaceRuntimeContext);
};

const createApp = () =>
  new Elysia().use(
    createLinearRoutes({
      db: linearTestDb,
      resolveWorkspaceContext,
    })
  );

async function setupLinearTestDb() {
  sqlite.exec("DROP TABLE IF EXISTS cell_timing_events;");
  sqlite.exec("DROP TABLE IF EXISTS cell_activity_events;");
  sqlite.exec("DROP TABLE IF EXISTS cell_resource_rollups;");
  sqlite.exec("DROP TABLE IF EXISTS cell_resource_history;");
  sqlite.exec("DROP TABLE IF EXISTS cell_services;");
  sqlite.exec("DROP TABLE IF EXISTS cell_provisioning_state;");
  sqlite.exec("DROP TABLE IF EXISTS cells;");
  sqlite.exec("DROP TABLE IF EXISTS workspace_linear_integrations;");
  sqlite.exec("DROP TABLE IF EXISTS __drizzle_migrations;");

  const packageRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const migrationsFolder = join(packageRoot, "src", "migrations");
  await migrate(linearTestDb, { migrationsFolder });
}

describe("createLinearRoutes", () => {
  beforeAll(async () => {
    await setupLinearTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await linearTestDb.delete(linearIntegrations);
    process.env.LINEAR_TOKEN_ENCRYPTION_SECRET = "";
  });

  afterEach(() => {
    process.env.LINEAR_TOKEN_ENCRYPTION_SECRET = "";
    vi.restoreAllMocks();
  });

  it("returns a disconnected status when no Linear record exists", async () => {
    const response = await createApp().handle(
      new Request(
        `http://localhost/api/linear/status?workspaceId=${WORKSPACE.id}`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      connected: false,
      user: null,
      organization: null,
      team: null,
    });
  });

  it("returns 400 when the workspace id is stale or unknown", async () => {
    const response = await createApp().handle(
      new Request(
        "http://localhost/api/linear/status?workspaceId=missing-workspace"
      )
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    await expect(response.json()).resolves.toEqual({
      message: "Workspace 'missing-workspace' not found",
    });
  });

  it("saves a pasted personal token without requiring OAuth env", async () => {
    vi.spyOn(LinearClientModule, "fetchLinearViewerContext").mockResolvedValue({
      viewer: {
        id: "linear-user-1",
        displayName: "Linear User",
        name: "Linear User",
        email: "linear@example.com",
      } as never,
      organization: {
        id: "linear-org-1",
        name: "Linear Org",
      } as never,
    });

    const response = await createApp().handle(
      new Request("http://localhost/api/linear/token", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          accessToken: "linear-access-token",
        }),
      })
    );

    expect(response.status).toBe(HTTP_OK);
    await expect(response.json()).resolves.toEqual({
      connected: true,
      user: {
        id: "linear-user-1",
        name: "Linear User",
        email: "linear@example.com",
      },
      organization: {
        id: "linear-org-1",
        name: "Linear Org",
      },
      team: null,
    });

    const [integration] = await linearTestDb
      .select()
      .from(linearIntegrations)
      .where(eq(linearIntegrations.workspaceId, WORKSPACE.id));

    expect(integration).toBeDefined();
    if (!integration) {
      throw new Error("Expected Linear integration to be stored");
    }

    expect(readStoredLinearSecret(integration.accessToken, null)).toBe(
      "linear-access-token"
    );
    expect(integration.refreshToken).toBeNull();
    expect(integration.accessTokenExpiresAt).toBeNull();
  });

  it("rejects empty token input after trimming", async () => {
    const response = await createApp().handle(
      new Request("http://localhost/api/linear/token", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          accessToken: "   ",
        }),
      })
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    await expect(response.json()).resolves.toEqual({
      message: "A Linear personal API token is required",
    });
  });

  it("returns 401 when the personal token is invalid", async () => {
    vi.spyOn(LinearClientModule, "fetchLinearViewerContext").mockRejectedValue({
      message: "Authentication failed",
      status: HTTP_UNAUTHORIZED,
    });

    const response = await createApp().handle(
      new Request("http://localhost/api/linear/token", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          accessToken: "invalid-token",
        }),
      })
    );

    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    await expect(response.json()).resolves.toEqual({
      message: "Authentication failed",
    });
  });

  it("returns 403 when Linear rejects the token with a permission error", async () => {
    vi.spyOn(LinearClientModule, "fetchLinearViewerContext").mockRejectedValue({
      message: "You do not have permission to access this resource",
      status: HTTP_FORBIDDEN,
    });

    const response = await createApp().handle(
      new Request("http://localhost/api/linear/token", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          accessToken: "forbidden-token",
        }),
      })
    );

    expect(response.status).toBe(HTTP_FORBIDDEN);
    await expect(response.json()).resolves.toEqual({
      message: "You do not have permission to access this resource",
    });
  });

  it("returns 500 when saving the token hits an unexpected server error", async () => {
    vi.spyOn(LinearClientModule, "fetchLinearViewerContext").mockRejectedValue(
      new Error("boom")
    );

    const response = await createApp().handle(
      new Request("http://localhost/api/linear/token", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          accessToken: "linear-access-token",
        }),
      })
    );

    expect(response.status).toBe(HTTP_INTERNAL_ERROR);
    await expect(response.json()).resolves.toEqual({
      message: "Failed to save the Linear token",
    });
  });

  it("lists available Linear teams for a connected workspace", async () => {
    await insertConnectedIntegration();
    vi.spyOn(LinearClientModule, "listLinearTeams").mockResolvedValue([
      {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
      } as never,
    ]);

    const response = await createApp().handle(
      new Request(
        `http://localhost/api/linear/teams?workspaceId=${WORKSPACE.id}`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    await expect(response.json()).resolves.toEqual({
      teams: [
        {
          id: "team-1",
          key: "ENG",
          name: "Engineering",
        },
      ],
    });
  });

  it("updates the linked team for the workspace", async () => {
    await insertConnectedIntegration();
    vi.spyOn(LinearClientModule, "fetchLinearTeam").mockResolvedValue({
      id: "team-1",
      key: "ENG",
      name: "Engineering",
    } as never);

    const response = await createApp().handle(
      new Request("http://localhost/api/linear/team", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          workspaceId: WORKSPACE.id,
          teamId: "team-1",
        }),
      })
    );

    expect(response.status).toBe(HTTP_OK);
    await expect(response.json()).resolves.toEqual({
      connected: true,
      user: {
        id: "linear-user-1",
        name: "Linear User",
        email: "linear@example.com",
      },
      organization: {
        id: "linear-org-1",
        name: "Linear Org",
      },
      team: {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
      },
    });
  });

  it("returns Linear issues for the linked team", async () => {
    await insertConnectedIntegration({
      teamId: "team-1",
      teamKey: "ENG",
      teamName: "Engineering",
    });
    vi.spyOn(LinearClientModule, "listLinearTeamIssues").mockResolvedValue({
      nodes: [makeLinearIssue()],
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
      },
    } as never);

    const response = await createApp().handle(
      new Request(
        `http://localhost/api/linear/issues?workspaceId=${WORKSPACE.id}`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const payload = (await response.json()) as {
      issues: Array<{ identifier: string; title: string }>;
      hasNextPage: boolean;
    };
    expect(payload.issues).toHaveLength(1);
    expect(payload.issues[0]).toMatchObject({
      identifier: "ENG-42",
      title: "Improve Linear integration",
      description: "Investigate the issue details",
    });
    expect(payload.hasNextPage).toBe(false);
  });

  it("returns one Linear issue for the linked team", async () => {
    await insertConnectedIntegration({
      teamId: "team-1",
      teamKey: "ENG",
      teamName: "Engineering",
    });
    vi.spyOn(LinearClientModule, "fetchLinearIssue").mockResolvedValue(
      makeLinearIssue({ description: "Investigate the issue details" }) as never
    );

    const response = await createApp().handle(
      new Request(
        `http://localhost/api/linear/issues/issue-1?workspaceId=${WORKSPACE.id}`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    await expect(response.json()).resolves.toMatchObject({
      identifier: "ENG-42",
      description: "Investigate the issue details",
    });
  });

  it("disconnects Linear and deletes the stored integration", async () => {
    await insertConnectedIntegration();

    const response = await createApp().handle(
      new Request(`http://localhost/api/linear?workspaceId=${WORKSPACE.id}`, {
        method: "DELETE",
      })
    );

    expect(response.status).toBe(HTTP_NO_CONTENT);

    const remaining = await linearTestDb
      .select()
      .from(linearIntegrations)
      .where(eq(linearIntegrations.workspaceId, WORKSPACE.id));
    expect(remaining).toHaveLength(0);
  });
});

async function insertConnectedIntegration(
  overrides: Partial<typeof linearIntegrations.$inferInsert> = {}
) {
  await linearTestDb.insert(linearIntegrations).values({
    workspaceId: WORKSPACE.id,
    accessToken: storeLinearSecret("linear-access-token", null),
    refreshToken: null,
    accessTokenExpiresAt: null,
    tokenType: "Bearer",
    scope: null,
    linearUserId: "linear-user-1",
    linearUserName: "Linear User",
    linearUserEmail: "linear@example.com",
    linearOrganizationId: "linear-org-1",
    linearOrganizationName: "Linear Org",
    teamId: null,
    teamKey: null,
    teamName: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  });
}

function makeLinearIssue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "issue-1",
    teamId: "team-1",
    identifier: "ENG-42",
    title: "Improve Linear integration",
    description: "Investigate the issue details",
    url: "https://linear.app/hiverun/issue/ENG-42",
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    completedAt: null,
    assignee: {
      id: "assignee-1",
      displayName: "Assignee Person",
      name: "Assignee Person",
      email: "assignee@example.com",
    },
    state: {
      id: "state-1",
      name: "Backlog",
      color: "#aaaaaa",
    },
    ...overrides,
  };
}
