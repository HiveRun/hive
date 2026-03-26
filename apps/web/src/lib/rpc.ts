import { getApiBase } from "@/lib/api-base";
import {
  type AshRpcError,
  activateWorkspace,
  createCell,
  deleteCell,
  deleteManyCells,
  deleteWorkspace,
  getAgentSessionByCell,
  getCell,
  listCellActivity,
  listCells,
  listCellTimings,
  listGlobalCellTimings,
  listServices,
  listWorkspaces,
  registerWorkspace,
  restartService,
  restartServices,
  resumeCellSetup,
  retryCellSetup,
  setAgentSessionMode,
  startService,
  startServices,
  stopService,
  stopServices,
} from "@/lib/generated/ash-rpc";

const API_URL = getApiBase();

type QueryValue = string | number | boolean | null | undefined;

type QueryParams = Record<string, QueryValue>;

type RpcError = {
  message: string;
  value?: unknown;
};

type RpcResult<T> = Promise<{
  data: T;
  error: RpcError | null;
}>;

type RequestOptions<TBody = unknown> = {
  query?: QueryParams;
  body?: TBody;
};

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;
const DEFAULT_TIMING_LIMIT = 200;
const MAX_TIMING_LIMIT = 1000;
const DEFAULT_SERVICE_LOG_LINES = 200;
const MAX_SERVICE_LOG_LINES = 2000;

const workspaceFields: Parameters<typeof listWorkspaces>[0]["fields"] = [
  "id",
  "path",
  "label",
  "lastOpenedAt",
  "insertedAt",
];

const cellFields: Parameters<typeof listCells>[0]["fields"] = [
  "id",
  "name",
  "description",
  "templateId",
  "workspaceRootPath",
  "workspacePath",
  "opencodeSessionId",
  "status",
  "lastSetupError",
  "branchName",
  "baseCommit",
  "insertedAt",
  "updatedAt",
  "workspaceId",
];

const activityFields: Parameters<typeof listCellActivity>[0]["fields"] = [
  "id",
  "cellId",
  "serviceId",
  "type",
  "source",
  "toolName",
  "metadata",
  "insertedAt",
];

const cellMutationFields: Parameters<typeof createCell>[0]["fields"] = [
  "id",
  "name",
  "workspaceId",
  "description",
  "templateId",
  "workspaceRootPath",
  "workspacePath",
  "opencodeSessionId",
  "opencodeCommand",
  "createdAt",
  "status",
  "lastSetupError",
  "branchName",
  "baseCommit",
  "updatedAt",
];

const deleteCellFields: Parameters<typeof deleteCell>[0]["fields"] = [
  "deletedId",
  "workspaceId",
];

const deleteManyCellFields: Parameters<typeof deleteManyCells>[0]["fields"] = [
  "deletedIds",
  "failedIds",
];

const timingFields: Parameters<typeof listCellTimings>[0]["fields"] = [
  "id",
  "cellId",
  "cellName",
  "workspaceId",
  "templateId",
  "runId",
  "workflow",
  "step",
  "status",
  "attempt",
  "error",
  "metadata",
  "durationMs",
  "insertedAt",
];

const serviceFields: Parameters<typeof listServices>[0]["fields"] = [
  "id",
  "name",
  "type",
  "status",
  "command",
  "cwd",
  "logPath",
  "lastKnownError",
  "env",
  "updatedAt",
  "recentLogs",
  "totalLogLines",
  "hasMoreLogs",
  "processAlive",
  "portReachable",
  "url",
  "pid",
  "port",
  "cpuPercent",
  "rssBytes",
  "resourceSampledAt",
  "resourceUnavailableReason",
];

const agentSessionFields: Parameters<
  typeof getAgentSessionByCell
>[0]["fields"] = [
  "id",
  "cellId",
  "templateId",
  "provider",
  "status",
  "workspacePath",
  "createdAt",
  "updatedAt",
  "modelId",
  "modelProviderId",
  "startMode",
  "currentMode",
  "modeUpdatedAt",
];

export type CreateCellInput = {
  workspaceId: string;
  templateId: string;
  name: string;
  description?: string;
  providerId?: string;
  modelId?: string;
  startMode?: "plan" | "build";
  spawnFromMode?: "head" | "branch" | "pr";
  spawnFromValue?: string;
};

const buildUrl = (path: string, query?: QueryParams) => {
  const url = new URL(path, API_URL);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

const buildError = async (response: Response): Promise<RpcError> => {
  const payload = await response
    .json()
    .catch(() => ({ message: response.statusText }));

  const message =
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
      ? payload.message
      : response.statusText || "Request failed";

  return {
    message,
    value: payload,
  };
};

const ashFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const path = typeof input === "string" ? input : input.toString();
  return fetch(buildUrl(path), init);
};

const ashRpcError = (errors: AshRpcError[]): RpcError => ({
  message:
    errors.find((error) => error.shortMessage)?.shortMessage ||
    errors[0]?.message ||
    "Request failed",
  value: { errors },
});

const parseNumberQuery = (
  value: QueryValue,
  defaultValue: number,
  maxValue: number
) => {
  let parsedValue = Number.NaN;

  if (typeof value === "number") {
    parsedValue = value;
  } else if (typeof value === "string") {
    parsedValue = Number(value);
  }

  if (!Number.isFinite(parsedValue)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsedValue, 1), maxValue);
};

const parseStringQuery = (value: QueryValue) =>
  typeof value === "string" && value !== "" ? value : undefined;

const parseNonNegativeNumberQuery = (
  value: QueryValue,
  defaultValue: number
) => {
  let parsedValue = Number.NaN;

  if (typeof value === "number") {
    parsedValue = value;
  } else if (typeof value === "string") {
    parsedValue = Number(value);
  }

  if (!Number.isFinite(parsedValue)) {
    return defaultValue;
  }

  return Math.max(parsedValue, 0);
};

const parseWorkflowQuery = (value: QueryValue) =>
  value === "create" || value === "delete" ? value : undefined;

const parseTypesQuery = (value: QueryValue) => {
  if (typeof value !== "string") {
    return;
  }

  const types = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return types.length > 0 ? types : undefined;
};

const parseActivityCursor = (cursor: QueryValue) => {
  if (typeof cursor !== "string") {
    return null;
  }

  const [millis, id] = cursor.split(":", 2);

  if (!(millis && id)) {
    return null;
  }

  const parsedMillis = Number(millis);

  if (!Number.isFinite(parsedMillis)) {
    return null;
  }

  return {
    cursorCreatedAt: new Date(parsedMillis).toISOString(),
    cursorId: id,
  };
};

const fromAshResult = <T>(
  result: { success: true; data: T } | { success: false; errors: AshRpcError[] }
): { data: T; error: RpcError | null } => {
  if (result.success) {
    return { data: result.data, error: null };
  }

  return {
    data: null as T,
    error: ashRpcError(result.errors),
  };
};

const listTimingPayload = async (input: {
  cellId?: string;
  workspaceId?: string;
  limit: number;
  workflow?: "create" | "delete";
  runId?: string;
}) => {
  const result = input.cellId
    ? await listCellTimings({
        input: {
          cellId: input.cellId,
          limit: input.limit,
          ...(input.workflow ? { workflow: input.workflow } : {}),
          ...(input.runId ? { runId: input.runId } : {}),
        },
        fields: timingFields,
        customFetch: ashFetch,
      })
    : await listGlobalCellTimings({
        input: {
          limit: input.limit,
          ...(input.workflow ? { workflow: input.workflow } : {}),
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.cellId ? { cellId: input.cellId } : {}),
        },
        fields: timingFields,
        customFetch: ashFetch,
      });

  const response = fromAshResult(result);

  if (response.error) {
    return response;
  }

  return response;
};

const request = async <TResponse = unknown, TBody = unknown>(
  method: string,
  path: string,
  options?: RequestOptions<TBody>
): RpcResult<TResponse> => {
  const response = await fetch(buildUrl(path, options?.query), {
    method,
    headers:
      options?.body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
          },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    return {
      data: null as TResponse,
      error: await buildError(response),
    };
  }

  const data = (await response.json().catch(() => null)) as TResponse;
  return { data, error: null };
};

const get = <TResponse = unknown>(path: string, query?: QueryParams) =>
  request<TResponse>("GET", path, { query });

const cellRoutes = (id: string) => ({
  get: (options?: { query?: QueryParams }) =>
    options?.query?.includeSetupLog
      ? get(`/api/cells/${id}`, options.query)
      : getCell({
          input: { id },
          fields: cellFields,
          customFetch: ashFetch,
        }).then((result) => {
          const response = fromAshResult(result);

          if (response.error || !response.data) {
            return {
              data: null,
              error:
                response.error ??
                ({ message: "Cell not found" } satisfies RpcError),
            };
          }

          return response;
        }),
  delete: () =>
    deleteCell({
      input: { cellId: id },
      fields: deleteCellFields,
      customFetch: ashFetch,
    }).then(fromAshResult),
  services: Object.assign(
    (serviceParams: { serviceId: string }) => ({
      start: {
        post: () =>
          startService({
            input: { serviceId: serviceParams.serviceId },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
      stop: {
        post: () =>
          stopService({
            input: { serviceId: serviceParams.serviceId },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
      restart: {
        post: () =>
          restartService({
            input: { serviceId: serviceParams.serviceId },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
    }),
    {
      get: (options?: { query?: QueryParams }) =>
        listServices({
          input: {
            cellId: id,
            includeResources: options?.query?.includeResources === true,
            logLines: parseNumberQuery(
              options?.query?.logLines,
              DEFAULT_SERVICE_LOG_LINES,
              MAX_SERVICE_LOG_LINES
            ),
            logOffset: parseNonNegativeNumberQuery(
              options?.query?.logOffset,
              0
            ),
          },
          fields: serviceFields,
          customFetch: ashFetch,
        }).then(fromAshResult),
      start: {
        post: () =>
          startServices({
            input: { cellId: id },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
      stop: {
        post: () =>
          stopServices({
            input: { cellId: id },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
      restart: {
        post: () =>
          restartServices({
            input: { cellId: id },
            fields: serviceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      },
    }
  ),
  activity: {
    get: async (options?: { query?: QueryParams }) => {
      const safeLimit = parseNumberQuery(
        options?.query?.limit,
        DEFAULT_ACTIVITY_LIMIT,
        MAX_ACTIVITY_LIMIT
      );
      const cursor = parseActivityCursor(options?.query?.cursor);
      const types = parseTypesQuery(options?.query?.types);

      const result = await listCellActivity({
        input: {
          cellId: id,
          limit: safeLimit,
          ...(cursor ?? {}),
          ...(types?.length ? { types } : {}),
        },
        fields: activityFields,
        customFetch: ashFetch,
      });
      const response = fromAshResult(result);

      if (response.error) {
        return response;
      }

      return response;
    },
  },
  timings: {
    get: async (options?: { query?: QueryParams }) =>
      listTimingPayload({
        cellId: id,
        limit: parseNumberQuery(
          options?.query?.limit,
          DEFAULT_TIMING_LIMIT,
          MAX_TIMING_LIMIT
        ),
        workflow: parseWorkflowQuery(options?.query?.workflow),
        runId: parseStringQuery(options?.query?.runId),
      }),
  },
  setup: {
    retry: {
      post: () =>
        retryCellSetup({
          input: { cellId: id },
          fields: cellMutationFields,
          customFetch: ashFetch,
        }).then(fromAshResult),
    },
    resume: {
      post: () =>
        resumeCellSetup({
          input: { cellId: id },
          fields: cellMutationFields,
          customFetch: ashFetch,
        }).then(fromAshResult),
    },
  },
});

const workspaceRoutes = (id: string) => ({
  activate: {
    post: () =>
      activateWorkspace({
        identity: id,
        fields: workspaceFields,
        customFetch: ashFetch,
      }).then(fromAshResult),
  },
  delete: () =>
    deleteWorkspace({
      identity: id,
      customFetch: ashFetch,
    }).then(fromAshResult),
});

const sessionRoutes = (id: string) => ({
  mode: {
    post: (body: { mode: "plan" | "build" }) =>
      setAgentSessionMode({
        input: { sessionId: id, mode: body.mode },
        fields: agentSessionFields,
        customFetch: ashFetch,
      }).then(fromAshResult),
  },
});

export const rpc = {
  api: {
    cells: Object.assign((params: { id: string }) => cellRoutes(params.id), {
      get: async (options?: { query?: QueryParams }) => {
        const workspaceId = parseStringQuery(options?.query?.workspaceId);
        const result = await listCells({
          input: workspaceId ? { workspaceId } : undefined,
          fields: cellFields,
          customFetch: ashFetch,
        });
        const response = fromAshResult(result);

        if (response.error) {
          return response;
        }

        return response;
      },
      post: (body: CreateCellInput) =>
        createCell({
          input: {
            workspaceId: body.workspaceId,
            ...(body.name ? { name: body.name } : {}),
            ...(body.description ? { description: body.description } : {}),
            ...(body.templateId ? { templateId: body.templateId } : {}),
            ...(body.providerId ? { providerId: body.providerId } : {}),
            ...(body.modelId ? { modelId: body.modelId } : {}),
            ...(body.startMode ? { startMode: body.startMode } : {}),
          },
          fields: cellMutationFields,
          customFetch: ashFetch,
        }).then(fromAshResult),
      delete: (body?: { ids: string[] }) =>
        deleteManyCells({
          input: { ids: body?.ids ?? [] },
          fields: deleteManyCellFields,
          customFetch: ashFetch,
        }).then(fromAshResult),
      timings: {
        global: {
          get: (options?: { query?: QueryParams }) =>
            listTimingPayload({
              limit: parseNumberQuery(
                options?.query?.limit,
                DEFAULT_TIMING_LIMIT,
                MAX_TIMING_LIMIT
              ),
              workflow: parseWorkflowQuery(options?.query?.workflow),
              runId: parseStringQuery(options?.query?.runId),
              workspaceId: parseStringQuery(options?.query?.workspaceId),
              cellId: parseStringQuery(options?.query?.cellId),
            }),
        },
      },
    }),
    agents: {
      sessions: Object.assign(
        (params: { id: string }) => sessionRoutes(params.id),
        {
          byCell: (params: { cellId: string }) => ({
            get: () =>
              getAgentSessionByCell({
                input: { cellId: params.cellId },
                fields: agentSessionFields,
                customFetch: ashFetch,
              }).then(fromAshResult),
          }),
        }
      ),
    },
    workspaces: Object.assign(
      (params: { id: string }) => workspaceRoutes(params.id),
      {
        get: async () => {
          const result = await listWorkspaces({
            fields: workspaceFields,
            customFetch: ashFetch,
          });
          const response = fromAshResult(result);

          if (response.error) {
            return response;
          }

          return response;
        },
        post: (body: { path: string; label?: string; activate?: boolean }) =>
          registerWorkspace({
            input: body,
            fields: workspaceFields,
            customFetch: ashFetch,
          }).then(fromAshResult),
      }
    ),
    example: {
      get: () => get("/api/example"),
    },
  },
};
