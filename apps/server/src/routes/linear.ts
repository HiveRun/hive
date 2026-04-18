import { Elysia, t } from "elysia";
import {
  DatabaseService,
  type DatabaseService as DatabaseServiceType,
} from "../db";
import {
  createLinearClient,
  fetchLinearIssue,
  fetchLinearTeam,
  fetchLinearViewerContext,
  LinearAuthenticationError,
  listLinearTeamIssues,
  listLinearTeams,
} from "../linear/client";
import { getLinearTokenEncryptionSecret } from "../linear/config";
import {
  mapLinearIssue,
  mapLinearStatus,
  mapLinearTeam,
} from "../linear/mappers";
import {
  deleteLinearIntegration,
  getLinearIntegration,
  setLinearLinkedTeam,
  upsertLinearConnection,
} from "../linear/repository";
import {
  readStoredLinearSecret,
  storeLinearSecret,
} from "../linear/token-crypto";
import {
  LinearIssueListResponseSchema,
  LinearIssueSchema,
  LinearStatusResponseSchema,
  LinearTeamListResponseSchema,
} from "../schema/api";
import type { ResolveWorkspaceContext } from "../workspaces/context";
import {
  createWorkspaceContextPlugin,
  WorkspaceContextResolutionError,
} from "../workspaces/plugin";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NO_CONTENT: 204,
  INTERNAL_ERROR: 500,
} as const;

const DEFAULT_ISSUE_PAGE_SIZE = 50;

const ErrorSchema = t.Object({
  message: t.String(),
});

const OptionalWorkspaceSchema = t.Object({
  workspaceId: t.Optional(t.String()),
});

const SaveTokenBodySchema = t.Object({
  workspaceId: t.Optional(t.String()),
  accessToken: t.String({ minLength: 1 }),
});

const SelectTeamBodySchema = t.Object({
  workspaceId: t.Optional(t.String()),
  teamId: t.String({ minLength: 1 }),
});

const IssueListQuerySchema = t.Object({
  workspaceId: t.Optional(t.String()),
  after: t.Optional(t.String()),
});

const IssueParamsSchema = t.Object({
  issueId: t.String({ minLength: 1 }),
});

type DatabaseClient = DatabaseServiceType["db"];

type LinearRouteDependencies = {
  db?: DatabaseClient;
  resolveWorkspaceContext?: ResolveWorkspaceContext;
};

class LinearRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LinearRouteError";
    this.status = status;
  }
}

const formatUnknown = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  return fallback;
};

const asLinearRouteError = (error: unknown, fallback: string) => {
  if (error instanceof LinearRouteError) {
    return error;
  }

  if (error instanceof WorkspaceContextResolutionError) {
    return new LinearRouteError(HTTP_STATUS.BAD_REQUEST, error.message);
  }

  if (error instanceof LinearAuthenticationError) {
    return new LinearRouteError(HTTP_STATUS.UNAUTHORIZED, error.message);
  }

  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= HTTP_STATUS.BAD_REQUEST &&
    error.status < HTTP_STATUS.INTERNAL_ERROR
  ) {
    return new LinearRouteError(
      error.status,
      formatUnknown(error, "Linear authentication failed")
    );
  }

  return new LinearRouteError(HTTP_STATUS.INTERNAL_ERROR, fallback);
};

const normalizeAccessToken = (value: string) => {
  const accessToken = value.trim();
  if (!accessToken) {
    throw new LinearRouteError(
      HTTP_STATUS.BAD_REQUEST,
      "A Linear personal API token is required"
    );
  }

  return accessToken;
};

const resolveIntegrationOrThrow = async (
  db: DatabaseClient,
  workspaceId: string
) => {
  const integration = await getLinearIntegration(db, workspaceId);
  if (!integration) {
    throw new LinearRouteError(
      HTTP_STATUS.NOT_FOUND,
      "Connect Linear for this workspace before using Linear features"
    );
  }

  return integration;
};

const readStoredAccessToken = (value: string) => {
  try {
    return readStoredLinearSecret(value, getLinearTokenEncryptionSecret());
  } catch {
    throw new LinearAuthenticationError(
      "Stored Linear token is unreadable. Save the token again and try again."
    );
  }
};

const resolveAuthorizedLinearClient = async ({
  db,
  workspaceId,
}: {
  db: DatabaseClient;
  workspaceId: string;
}) => {
  const integration = await resolveIntegrationOrThrow(db, workspaceId);
  const accessToken = readStoredAccessToken(integration.accessToken);

  if (!accessToken) {
    throw new LinearAuthenticationError(
      "Stored Linear token is missing. Save the token again and try again."
    );
  }

  return {
    client: createLinearClient(accessToken),
    integration,
  };
};

const resolveLinkedTeamId = async (db: DatabaseClient, workspaceId: string) => {
  const integration = await resolveIntegrationOrThrow(db, workspaceId);
  if (!integration.teamId) {
    throw new LinearRouteError(
      HTTP_STATUS.BAD_REQUEST,
      "Link a Linear team for this workspace before browsing issues"
    );
  }

  return integration.teamId;
};

const handleRouteFailure = (
  set: { status?: number | string },
  error: unknown,
  fallback: string
) => {
  const routeError = asLinearRouteError(error, fallback);
  set.status = routeError.status;
  return { message: routeError.message };
};

export function createLinearRoutes({
  db = DatabaseService.db,
  resolveWorkspaceContext,
}: LinearRouteDependencies = {}) {
  return new Elysia({ prefix: "/api/linear" })
    .use(createWorkspaceContextPlugin({ resolveWorkspaceContext }))
    .get(
      "/status",
      async ({ query, getWorkspaceContext, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          const integration = await getLinearIntegration(
            db,
            workspaceContext.workspace.id
          );
          set.status = HTTP_STATUS.OK;
          return mapLinearStatus(integration);
        } catch (error) {
          return handleRouteFailure(set, error, "Failed to load Linear status");
        }
      },
      {
        query: OptionalWorkspaceSchema,
        response: {
          200: LinearStatusResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
        },
      }
    )
    .put(
      "/token",
      async ({ body, getWorkspaceContext, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(body.workspaceId);
          const accessToken = normalizeAccessToken(body.accessToken);
          const client = createLinearClient(accessToken);
          const { viewer, organization } =
            await fetchLinearViewerContext(client);
          const integration = await upsertLinearConnection(db, {
            workspaceId: workspaceContext.workspace.id,
            accessToken: storeLinearSecret(
              accessToken,
              getLinearTokenEncryptionSecret()
            ),
            refreshToken: null,
            accessTokenExpiresAt: null,
            tokenType: "Bearer",
            scope: null,
            linearUserId: viewer.id,
            linearUserName: viewer.displayName || viewer.name || null,
            linearUserEmail: viewer.email ?? null,
            linearOrganizationId: organization.id,
            linearOrganizationName: organization.name,
          });

          set.status = HTTP_STATUS.OK;
          return mapLinearStatus(integration);
        } catch (error) {
          return handleRouteFailure(
            set,
            error,
            "Failed to save the Linear token"
          );
        }
      },
      {
        body: SaveTokenBodySchema,
        response: {
          200: LinearStatusResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
        },
      }
    )
    .get(
      "/teams",
      async ({ query, getWorkspaceContext, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          const { client } = await resolveAuthorizedLinearClient({
            db,
            workspaceId: workspaceContext.workspace.id,
          });

          set.status = HTTP_STATUS.OK;
          return {
            teams: (await listLinearTeams(client)).map(mapLinearTeam),
          };
        } catch (error) {
          return handleRouteFailure(set, error, "Failed to load Linear teams");
        }
      },
      {
        query: OptionalWorkspaceSchema,
        response: {
          200: LinearTeamListResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      }
    )
    .put(
      "/team",
      async ({ body, getWorkspaceContext, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(body.workspaceId);
          const { client } = await resolveAuthorizedLinearClient({
            db,
            workspaceId: workspaceContext.workspace.id,
          });
          const team = await fetchLinearTeam(client, body.teamId);

          await setLinearLinkedTeam(db, workspaceContext.workspace.id, {
            id: team.id,
            key: team.key ?? null,
            name: team.name,
          });

          const integration = await getLinearIntegration(
            db,
            workspaceContext.workspace.id
          );
          set.status = HTTP_STATUS.OK;
          return mapLinearStatus(integration);
        } catch (error) {
          return handleRouteFailure(
            set,
            error,
            "Failed to link the Linear team"
          );
        }
      },
      {
        body: SelectTeamBodySchema,
        response: {
          200: LinearStatusResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      }
    )
    .get(
      "/issues",
      async ({ query, getWorkspaceContext, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          const workspaceId = workspaceContext.workspace.id;
          const { client } = await resolveAuthorizedLinearClient({
            db,
            workspaceId,
          });
          const teamId = await resolveLinkedTeamId(db, workspaceId);
          const issues = await listLinearTeamIssues({
            client,
            teamId,
            after: query.after,
            first: DEFAULT_ISSUE_PAGE_SIZE,
          });

          set.status = HTTP_STATUS.OK;
          return {
            issues: await Promise.all(
              issues.nodes.map((issue) =>
                mapLinearIssue(issue, { includeDescription: true })
              )
            ),
            nextCursor: issues.pageInfo.endCursor ?? null,
            hasNextPage: issues.pageInfo.hasNextPage,
          };
        } catch (error) {
          return handleRouteFailure(set, error, "Failed to load Linear issues");
        }
      },
      {
        query: IssueListQuerySchema,
        response: {
          200: LinearIssueListResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      }
    )
    .get(
      "/issues/:issueId",
      async ({ getWorkspaceContext, params, query, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          const workspaceId = workspaceContext.workspace.id;
          const { client } = await resolveAuthorizedLinearClient({
            db,
            workspaceId,
          });
          const linkedTeamId = await resolveLinkedTeamId(db, workspaceId);
          const issue = await fetchLinearIssue(client, params.issueId);

          if (issue.teamId !== linkedTeamId) {
            throw new LinearRouteError(
              HTTP_STATUS.NOT_FOUND,
              "The requested Linear issue does not belong to the linked team"
            );
          }

          set.status = HTTP_STATUS.OK;
          return await mapLinearIssue(issue, { includeDescription: true });
        } catch (error) {
          return handleRouteFailure(
            set,
            error,
            "Failed to load the Linear issue"
          );
        }
      },
      {
        params: IssueParamsSchema,
        query: OptionalWorkspaceSchema,
        response: {
          200: LinearIssueSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      }
    )
    .delete(
      "/",
      async ({ getWorkspaceContext, query, set }) => {
        try {
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          await deleteLinearIntegration(db, workspaceContext.workspace.id);
          set.status = HTTP_STATUS.NO_CONTENT;
          return null;
        } catch (error) {
          return handleRouteFailure(set, error, "Failed to disconnect Linear");
        }
      },
      {
        query: OptionalWorkspaceSchema,
        response: {
          204: t.Null(),
          400: ErrorSchema,
          401: ErrorSchema,
        },
      }
    );
}

export const linearRoutes = createLinearRoutes();
