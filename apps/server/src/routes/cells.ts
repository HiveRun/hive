import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";

import { logger } from "@bogeychan/elysia-logger";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Elysia, type Static, sse, t } from "elysia";
import { loadEffectiveOpencodeDefaults } from "../agents/opencode-config";
import { getSharedOpencodeServerBaseUrl } from "../agents/opencode-server";
import type { AgentPromptInput, AgentRuntimeService } from "../agents/service";
import { agentRuntimeService } from "../agents/service";
import type { AgentMode } from "../agents/types";
import type { ProcessService, Template } from "../config/schema";
import {
  resolveServicePortProtocol,
  resolveServicePortViewer,
} from "../config/service-graph";
import {
  DatabaseService,
  type DatabaseService as DatabaseServiceType,
} from "../db";
import {
  type ActivityEventType,
  cellActivityEvents,
} from "../schema/activity-events";
import {
  CellActivityEventListResponseSchema,
  CellDiffResponseSchema,
  CellListResponseSchema,
  CellResponseSchema,
  CellServiceListResponseSchema,
  CellServiceSchema,
  CellTerminalActionResponseSchema,
  CellTerminalInputSchema,
  CellTerminalResizeSchema,
  CellTerminalSessionSchema,
  CellTimingListResponseSchema,
  CreateCellSchema,
  DeleteCellsSchema,
  DiffQuerySchema,
  RuntimeTerminalResizeResponseSchema,
  ServiceLogQuerySchema,
} from "../schema/api";
import {
  type CellProvisioningState,
  cellProvisioningStates,
} from "../schema/cell-provisioning";
import {
  type Cell,
  type CellStatus,
  cells,
  type NewCell,
} from "../schema/cells";
import { cellServicePorts, cellServices } from "../schema/services";
import {
  type CellTimingStatus,
  type CellTimingWorkflow,
  cellTimingEvents,
} from "../schema/timing-events";
import { createAsyncEventIterator } from "../services/async-iterator";
import {
  DEFAULT_ACTIVITY_LIMIT,
  fetchCellActivityPage,
  MAX_ACTIVITY_LIMIT,
  normalizeActivityLimit,
  normalizeActivityTypes,
  parseActivityCursor,
} from "../services/cell-activity";
import { runWithCellCleanupLock } from "../services/cell-cleanup-lock";
import {
  deleteCellWithLifecycle,
  removeCellWorkspace,
} from "../services/cell-delete-lifecycle";
import {
  buildPersistedCellPortEnvironment,
  removeCellRuntimeDir,
  resolveCellEnvironment,
} from "../services/cell-environment";
import {
  loadCellById,
  requireCellAvailableForRuntime,
} from "../services/cell-runtime-guard";
import { updateCellStatusAndEmit } from "../services/cell-status";
import {
  buildTimingRuns,
  type CellTimingStepRecord,
  DEFAULT_TIMING_LIMIT,
  MAX_TIMING_LIMIT,
  normalizeTimingLimit,
  normalizeTimingWorkflow,
  parseTimingStep,
} from "../services/cell-timing";
import type {
  ChatTerminalEvent,
  ChatTerminalSession,
} from "../services/chat-terminal";
import { chatTerminalService } from "../services/chat-terminal";
import {
  buildCellDiffPayload,
  parseDiffRequest,
} from "../services/diff-route-helpers";
import {
  type CellStatusEvent,
  type CellTimingEvent,
  emitCellStatusUpdate,
  emitCellTimingUpdate,
  subscribeToCellStatusEvents,
  subscribeToCellTimingEvents,
  subscribeToServiceEvents,
} from "../services/events";
import {
  createResourceSnapshotService,
  type ProcessResourceSnapshot,
} from "../services/resource-snapshot";
import type {
  ServiceTerminalEvent,
  ServiceTerminalSession,
} from "../services/service-terminal";
import type {
  EnsureCellServicesTimingEvent,
  ServiceSupervisorError,
  ServiceSupervisorService as ServiceSupervisorServiceType,
} from "../services/supervisor";
import {
  CommandExecutionError,
  isProcessAlive,
  ServiceSupervisorService,
  TemplateSetupError,
} from "../services/supervisor";
import {
  type CellTerminalEvent,
  type CellTerminalSession,
  cellTerminalService,
} from "../services/terminal";
import {
  resolveWorkspaceContext,
  type WorkspaceRuntimeContext,
} from "../workspaces/context";

import { createWorkspaceContextPlugin } from "../workspaces/plugin";
import { resolveCellsRoot, type WorkspaceRecord } from "../workspaces/registry";
import {
  type AsyncWorktreeManager,
  createWorktreeManager,
  describeWorktreeError,
  toAsyncWorktreeManager,
  type WorktreeCreateTimingEvent,
  type WorktreeManagerError,
  type WorktreeStartPoint,
} from "../worktree/manager";

type DatabaseClient = DatabaseServiceType["db"];

type WorkspaceContextResolverLike = (
  workspaceId?: string
) => WorkspaceRuntimeContext | Promise<WorkspaceRuntimeContext>;

type CreateCellRequest = Static<typeof CreateCellSchema>;
type CreateCellImageInput = NonNullable<
  CreateCellRequest["initialPromptImages"]
>[number];

const BASE64_DATA_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const resolveWorkspaceContextFromDeps = async (
  resolver: WorkspaceContextResolverLike,
  workspaceId?: string
): Promise<WorkspaceRuntimeContext> =>
  await Promise.resolve(resolver(workspaceId));

const createWorktreeManagerFetcher = (
  resolver: WorkspaceContextResolverLike
) => {
  const managerCache = new Map<string, AsyncWorktreeManager>();

  return async (workspaceId: string): Promise<AsyncWorktreeManager> => {
    const cached = managerCache.get(workspaceId);
    if (cached) {
      return cached;
    }

    const workspaceContext = await resolveWorkspaceContextFromDeps(
      resolver,
      workspaceId
    );
    const manager = toAsyncWorktreeManager(
      await workspaceContext.createWorktreeManager()
    );
    managerCache.set(workspaceId, manager);
    return manager;
  };
};

const resolveDeletionWorktreeService = async (
  resolver: WorkspaceContextResolverLike,
  cell: Cell
): Promise<AsyncWorktreeManager> => {
  try {
    const workspaceContext = await resolveWorkspaceContextFromDeps(
      resolver,
      cell.workspaceId
    );
    return toAsyncWorktreeManager(
      await workspaceContext.createWorktreeManager()
    );
  } catch (registryError) {
    try {
      return toAsyncWorktreeManager(
        createWorktreeManager(cell.workspaceRootPath)
      );
    } catch {
      throw registryError;
    }
  }
};

const createDeletionWorktreeServiceGetter = (
  resolver: WorkspaceContextResolverLike,
  cell: Cell
): (() => Promise<AsyncWorktreeManager>) => {
  const resolution = resolveDeletionWorktreeService(resolver, cell).then(
    (service) => ({ service }) as const,
    (error: unknown) => ({ error }) as const
  );

  return async () => {
    const result = await resolution;
    if ("error" in result) {
      throw result.error;
    }
    return result.service;
  };
};

type CellRouteDependencies = {
  db: DatabaseClient;
  resolveWorkspaceContext: WorkspaceContextResolverLike;
  ensureAgentSession: AgentRuntimeService["ensureAgentSession"];
  sendAgentMessage: AgentRuntimeService["sendAgentMessage"];
  closeAgentSession: AgentRuntimeService["closeAgentSession"];
  ensureServicesForCell: ServiceSupervisorServiceType["ensureCellServices"];
  startServiceById: ServiceSupervisorServiceType["startCellService"];
  startServicesForCell: ServiceSupervisorServiceType["startCellServices"];
  stopServiceById: ServiceSupervisorServiceType["stopCellService"];
  stopServicesForCell: ServiceSupervisorServiceType["stopCellServices"];
  runCellTeardown: ServiceSupervisorServiceType["runCellTeardown"];
  ensureTerminalSession: (args: {
    cellId: string;
    workspacePath: string;
    environment: Record<string, string>;
  }) => CellTerminalSession;
  getTerminalSession?: (cellId: string) => CellTerminalSession | null;
  readTerminalOutput: (cellId: string) => string;
  subscribeToTerminal: (
    cellId: string,
    listener: (event: CellTerminalEvent) => void
  ) => () => void;
  writeTerminalInput: (cellId: string, data: string) => void;
  resizeTerminal: (cellId: string, cols: number, rows: number) => void;
  closeTerminalSession: (cellId: string) => void;
  ensureChatTerminalSession?: (args: {
    cellId: string;
    workspacePath: string;
    opencodeSessionId: string;
    opencodeServerUrl: string;
    opencodeThemeMode?: OpencodeThemeMode;
    preferredModel?: { providerId: string; modelId: string; variant?: string };
    startMode?: AgentMode;
    environment: Record<string, string>;
  }) => ChatTerminalSession;
  getChatTerminalSession?: (cellId: string) => ChatTerminalSession | null;
  readChatTerminalOutput?: (cellId: string) => string;
  subscribeToChatTerminal?: (
    cellId: string,
    listener: (event: ChatTerminalEvent) => void
  ) => () => void;
  writeChatTerminalInput?: (cellId: string, data: string) => void;
  resizeChatTerminal?: (cellId: string, cols: number, rows: number) => void;
  closeChatTerminalSession?: (cellId: string) => void;
  getServiceTerminalSession: (
    serviceId: string
  ) => ServiceTerminalSession | null;
  readServiceTerminalOutput: (serviceId: string) => string;
  subscribeToServiceTerminal: (
    serviceId: string,
    listener: (event: ServiceTerminalEvent) => void
  ) => () => void;
  writeServiceTerminalInput: (serviceId: string, data: string) => void;
  resizeServiceTerminal: (
    serviceId: string,
    cols: number,
    rows: number
  ) => void;
  clearServiceTerminal: (serviceId: string) => void;
  getSetupTerminalSession: (cellId: string) => ServiceTerminalSession | null;
  readSetupTerminalOutput: (cellId: string) => string;
  subscribeToSetupTerminal: (
    cellId: string,
    listener: (event: ServiceTerminalEvent) => void
  ) => () => void;
  writeSetupTerminalInput: (cellId: string, data: string) => void;
  resizeSetupTerminal: (cellId: string, cols: number, rows: number) => void;
  clearSetupTerminal: (cellId: string) => void;
  sampleServiceResources: (
    pids: number[]
  ) => Promise<Map<number, ProcessResourceSnapshot>>;
};

const dependencyKeys: Array<keyof CellRouteDependencies> = [
  "db",
  "resolveWorkspaceContext",
  "ensureAgentSession",
  "sendAgentMessage",
  "closeAgentSession",
  "ensureServicesForCell",
  "startServiceById",
  "startServicesForCell",
  "stopServiceById",
  "stopServicesForCell",
  "runCellTeardown",
  "ensureTerminalSession",
  "readTerminalOutput",
  "subscribeToTerminal",
  "writeTerminalInput",
  "resizeTerminal",
  "closeTerminalSession",
  "getServiceTerminalSession",
  "readServiceTerminalOutput",
  "subscribeToServiceTerminal",
  "writeServiceTerminalInput",
  "resizeServiceTerminal",
  "clearServiceTerminal",
  "getSetupTerminalSession",
  "readSetupTerminalOutput",
  "subscribeToSetupTerminal",
  "writeSetupTerminalInput",
  "resizeSetupTerminal",
  "clearSetupTerminal",
  "sampleServiceResources",
];

const buildDefaultCellDependencies = (): CellRouteDependencies => {
  const { db: database } = DatabaseService;
  const agentRuntime = agentRuntimeService;
  const supervisor = ServiceSupervisorService;
  const terminal = cellTerminalService;
  const chatTerminal = chatTerminalService;
  const resourceSnapshot = createResourceSnapshotService();

  return {
    db: database,
    resolveWorkspaceContext: (workspaceId) =>
      resolveWorkspaceContext(workspaceId),
    ensureAgentSession: agentRuntime.ensureAgentSession,
    sendAgentMessage: agentRuntime.sendAgentMessage,
    closeAgentSession: agentRuntime.closeAgentSession,
    ensureServicesForCell: supervisor.ensureCellServices,
    startServiceById: supervisor.startCellService,
    startServicesForCell: supervisor.startCellServices,
    stopServiceById: supervisor.stopCellService,
    stopServicesForCell: supervisor.stopCellServices,
    runCellTeardown: supervisor.runCellTeardown,
    ensureTerminalSession: terminal.ensureSession,
    getTerminalSession: terminal.getSession,
    readTerminalOutput: terminal.readOutput,
    subscribeToTerminal: terminal.subscribe,
    writeTerminalInput: terminal.write,
    resizeTerminal: terminal.resize,
    closeTerminalSession: terminal.closeSession,
    ensureChatTerminalSession: chatTerminal.ensureSession,
    getChatTerminalSession: chatTerminal.getSession,
    readChatTerminalOutput: chatTerminal.readOutput,
    subscribeToChatTerminal: chatTerminal.subscribe,
    writeChatTerminalInput: chatTerminal.write,
    resizeChatTerminal: chatTerminal.resize,
    closeChatTerminalSession: chatTerminal.closeSession,
    getServiceTerminalSession: supervisor.getServiceTerminalSession,
    readServiceTerminalOutput: supervisor.readServiceTerminalOutput,
    subscribeToServiceTerminal: supervisor.subscribeToServiceTerminal,
    writeServiceTerminalInput: supervisor.writeServiceTerminalInput,
    resizeServiceTerminal: supervisor.resizeServiceTerminal,
    clearServiceTerminal: supervisor.clearServiceTerminal,
    getSetupTerminalSession: supervisor.getSetupTerminalSession,
    readSetupTerminalOutput: supervisor.readSetupTerminalOutput,
    subscribeToSetupTerminal: supervisor.subscribeToSetupTerminal,
    writeSetupTerminalInput: supervisor.writeSetupTerminalInput,
    resizeSetupTerminal: supervisor.resizeSetupTerminal,
    clearSetupTerminal: supervisor.clearSetupTerminal,
    sampleServiceResources: resourceSnapshot.samplePids,
  } satisfies CellRouteDependencies;
};

const hasAllDependencies = (
  overrides: Partial<CellRouteDependencies>
): overrides is CellRouteDependencies =>
  dependencyKeys.every((key) => overrides[key] !== undefined);

const resolveCellRouteDependencies = (() => {
  let cachedBaseDeps: Promise<CellRouteDependencies> | undefined;

  const loadBase = () => {
    if (!cachedBaseDeps) {
      cachedBaseDeps = Promise.resolve(buildDefaultCellDependencies());
    }
    return cachedBaseDeps;
  };

  return (overrides: Partial<CellRouteDependencies> = {}) => {
    if (hasAllDependencies(overrides)) {
      return Promise.resolve(overrides);
    }

    return loadBase().then((base) => ({ ...base, ...overrides }));
  };
})();

const buildDeletionDependencies = (deps: CellRouteDependencies) => ({
  database: deps.db,
  closeSession: deps.closeAgentSession,
  closeTerminalSession: deps.closeTerminalSession,
  closeChatTerminalSession: deps.closeChatTerminalSession,
  clearSetupTerminal: deps.clearSetupTerminal,
  stopCellServices: deps.stopServicesForCell,
  runCellTeardown: deps.runCellTeardown,
});

type CellServiceListResponse = Static<typeof CellServiceListResponseSchema>;
type CellDiffResponse = Static<typeof CellDiffResponseSchema>;
type CellServiceResponse = Static<typeof CellServiceSchema>;
type CellResponse = Static<typeof CellResponseSchema>;
type CellActivityEventListResponse = Static<
  typeof CellActivityEventListResponseSchema
>;
type CellTimingListResponse = Static<typeof CellTimingListResponseSchema>;

function readHiveAuditHeaders(request: Request): {
  source: string | null;
  toolName: string | null;
  auditEvent: string | null;
  serviceName: string | null;
} {
  return {
    source: request.headers.get("x-hive-source"),
    toolName: request.headers.get("x-hive-tool"),
    auditEvent: request.headers.get("x-hive-audit-event"),
    serviceName: request.headers.get("x-hive-service-name"),
  };
}

async function insertCellActivityEvent(args: {
  database: DatabaseClient;
  cellId: string;
  serviceId?: string | null;
  type: ActivityEventType;
  source?: string | null;
  toolName?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await args.database.insert(cellActivityEvents).values({
    id: crypto.randomUUID(),
    cellId: args.cellId,
    serviceId: args.serviceId ?? null,
    type: args.type,
    source: args.source ?? null,
    toolName: args.toolName ?? null,
    metadata: args.metadata ?? {},
    createdAt: new Date(),
  });
}

async function insertCellTimingEvent(args: {
  database: DatabaseClient;
  log: LoggerLike;
  cellId: string;
  cellName?: string | null;
  workflow: CellTimingWorkflow;
  runId: string;
  step: string;
  status: CellTimingStatus;
  durationMs: number;
  attempt?: number | null;
  error?: string | null;
  templateId?: string | null;
  workspaceId?: string | null;
  extraMetadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  const metadata: Record<string, unknown> = {
    workflow: args.workflow,
    runId: args.runId,
    step: args.step,
    status: args.status,
    durationMs: Math.max(0, Math.round(args.durationMs)),
    ...(args.attempt != null ? { attempt: args.attempt } : {}),
    ...(args.error ? { error: args.error } : {}),
    ...(args.templateId ? { templateId: args.templateId } : {}),
    ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    ...(args.extraMetadata ?? {}),
  };

  try {
    const createdAt = args.createdAt ?? new Date();
    await args.database.insert(cellTimingEvents).values({
      id: crypto.randomUUID(),
      cellId: args.cellId,
      cellName: args.cellName ?? null,
      workspaceId: args.workspaceId ?? null,
      templateId: args.templateId ?? null,
      workflow: args.workflow,
      runId: args.runId,
      step: args.step,
      status: args.status,
      durationMs: Math.max(0, Math.round(args.durationMs)),
      attempt: args.attempt ?? null,
      error: args.error ?? null,
      metadata,
      createdAt,
    });

    emitCellTimingUpdate({
      cellId: args.cellId,
      workflow: args.workflow,
      runId: args.runId,
      step: args.step,
      status: args.status,
      createdAt: createdAt.toISOString(),
    });
  } catch (error) {
    args.log.warn(
      {
        error,
        cellId: args.cellId,
        workflow: args.workflow,
        runId: args.runId,
        step: args.step,
      },
      "Failed to persist cell timing event"
    );
  }
}

async function fetchTimingSteps(args: {
  database: DatabaseClient;
  cellId?: string;
  workflow?: CellTimingWorkflow | null;
  runId?: string;
  workspaceId?: string;
}): Promise<CellTimingStepRecord[]> {
  const workflow = args.workflow ?? "create";
  const rows = await args.database
    .select()
    .from(cellTimingEvents)
    .where(
      and(
        args.cellId ? eq(cellTimingEvents.cellId, args.cellId) : undefined,
        eq(cellTimingEvents.workflow, workflow),
        args.runId ? eq(cellTimingEvents.runId, args.runId) : undefined,
        args.workspaceId
          ? eq(cellTimingEvents.workspaceId, args.workspaceId)
          : undefined
      )
    )
    .orderBy(desc(cellTimingEvents.createdAt), desc(cellTimingEvents.id))
    .limit(MAX_TIMING_LIMIT);

  return rows
    .map((row) => parseTimingStep(row))
    .filter((step): step is CellTimingStepRecord => Boolean(step));
}

function toTimingListResponse(
  steps: CellTimingStepRecord[],
  limit: number
): CellTimingListResponse {
  return {
    steps: steps.slice(0, limit),
    runs: buildTimingRuns(steps),
  } satisfies CellTimingListResponse;
}

type ServiceRow = {
  service: typeof cellServices.$inferSelect;
  cell: typeof cells.$inferSelect;
};

type RouteSet = {
  status?: number | string;
};

type RouteLog = {
  error: (payload: unknown, message: string) => void;
};

type MessageResponse = {
  message: string;
};

type MaybePromise<T> = T | Promise<T>;

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

const ErrorResponseSchema = t.Object({
  message: t.String(),
  details: t.Optional(t.String()),
});
const MessageResponseSchema = t.Object({ message: t.String() });
const CellIdParamsSchema = t.Object({ id: t.String() });
const CellServiceParamsSchema = t.Object({
  id: t.String(),
  serviceId: t.String(),
});
const RuntimeTerminalResizeOkResponseSchema = t.Object({
  ok: t.Boolean(),
  session: CellTerminalSessionSchema,
});
const TerminalErrorResponses = {
  404: MessageResponseSchema,
  409: MessageResponseSchema,
  500: MessageResponseSchema,
};
const CellTerminalStreamErrorResponses = {
  404: MessageResponseSchema,
  500: MessageResponseSchema,
};
const StandardCellErrorResponses = {
  400: MessageResponseSchema,
  404: MessageResponseSchema,
};
const DeleteCellErrorResponses = {
  404: MessageResponseSchema,
  500: ErrorResponseSchema,
};
const ServiceListRouteOptions = {
  params: CellIdParamsSchema,
  response: {
    200: CellServiceListResponseSchema,
    ...StandardCellErrorResponses,
    409: MessageResponseSchema,
    500: MessageResponseSchema,
  },
};
const ServiceActionRouteOptions = {
  params: CellServiceParamsSchema,
  response: {
    200: CellServiceSchema,
    ...StandardCellErrorResponses,
    409: MessageResponseSchema,
    500: MessageResponseSchema,
  },
};
const CellTerminalInputRouteOptions = {
  params: CellIdParamsSchema,
  body: CellTerminalInputSchema,
  response: {
    200: CellTerminalActionResponseSchema,
    404: MessageResponseSchema,
    500: MessageResponseSchema,
  },
};
const RuntimeTerminalInputRouteOptions = {
  params: CellIdParamsSchema,
  body: CellTerminalInputSchema,
  response: {
    200: CellTerminalActionResponseSchema,
    ...TerminalErrorResponses,
  },
};
const CellTerminalResizeRouteOptions = {
  params: CellIdParamsSchema,
  body: CellTerminalResizeSchema,
  response: {
    200: RuntimeTerminalResizeOkResponseSchema,
    404: MessageResponseSchema,
    500: MessageResponseSchema,
  },
};
const RuntimeTerminalResizeRouteOptions = {
  params: CellIdParamsSchema,
  body: CellTerminalResizeSchema,
  response: {
    200: RuntimeTerminalResizeResponseSchema,
    ...TerminalErrorResponses,
  },
};
const ServiceTerminalInputRouteOptions = {
  params: CellServiceParamsSchema,
  body: CellTerminalInputSchema,
  response: {
    200: CellTerminalActionResponseSchema,
    ...TerminalErrorResponses,
  },
};
const ServiceTerminalResizeRouteOptions = {
  params: CellServiceParamsSchema,
  body: CellTerminalResizeSchema,
  response: {
    200: RuntimeTerminalResizeResponseSchema,
    ...TerminalErrorResponses,
  },
};
async function withCellRoute<T>(args: {
  deps: CellRouteDependencies;
  cellId: string;
  set: RouteSet;
  run: (cell: typeof cells.$inferSelect) => MaybePromise<T>;
}): Promise<T | MessageResponse> {
  const cell = await loadCellById(args.deps.db, args.cellId);
  if (!cell) {
    args.set.status = HTTP_STATUS.NOT_FOUND;
    return { message: "Cell not found" };
  }

  return await args.run(cell);
}

async function withServiceRoute<T>(args: {
  deps: CellRouteDependencies;
  cellId: string;
  serviceId: string;
  set: RouteSet;
  run: (row: ServiceRow) => MaybePromise<T>;
}): Promise<T | MessageResponse> {
  const row = await fetchServiceRow(args.deps.db, args.cellId, args.serviceId);
  if (!row) {
    args.set.status = HTTP_STATUS.NOT_FOUND;
    return { message: "Service not found" };
  }

  return await args.run(row);
}

async function serializeServicesForCell(
  deps: CellRouteDependencies,
  database: DatabaseClient,
  cellId: string
): Promise<CellServiceListResponse> {
  const rows = await fetchServiceRows(database, cellId);
  const services = await Promise.all(
    rows.map((row) => serializeService(deps, database, row))
  );
  return { services };
}

function rejectDeletingCell(status: string, set: RouteSet) {
  if (status !== "deleting") {
    return null;
  }
  set.status = HTTP_STATUS.CONFLICT;
  return { message: "Cell is being deleted" } satisfies MessageResponse;
}

const isServiceSupervisorError = (
  error: unknown
): error is ServiceSupervisorError =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "ServiceSupervisorError";

const unwrapSupervisorError = (error: unknown): unknown => {
  if (isServiceSupervisorError(error)) {
    return error.cause;
  }

  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (isServiceSupervisorError(parsed)) {
        return parsed.cause;
      }
    } catch {
      // no-op
    }
  }

  return error;
};

async function recordServiceActivity(args: {
  deps: CellRouteDependencies;
  cellId: string;
  request: Request;
  type: ActivityEventType;
  serviceId?: string;
  metadata?: Record<string, unknown>;
}) {
  const audit = readHiveAuditHeaders(args.request);
  await insertCellActivityEvent({
    database: args.deps.db,
    cellId: args.cellId,
    serviceId: args.serviceId,
    type: args.type,
    source: audit.source,
    toolName: audit.toolName,
    metadata: args.metadata ?? {},
  });
}

async function runOrDispatchServiceAction(args: {
  action: () => MaybePromise<void>;
  queueKey: string;
  queueAction?: boolean;
  waitForAction?: boolean;
  log: RouteLog;
  logContext: Record<string, unknown>;
  errorMessage: string;
}): Promise<void> {
  const action = args.queueAction
    ? (
        cellServiceActionQueues
          .get(args.queueKey)
          ?.catch(() => Promise.resolve()) ?? Promise.resolve()
      ).then(args.action)
    : Promise.resolve().then(args.action);
  if (args.queueAction) {
    cellServiceActionQueues.set(args.queueKey, action);
    const clearQueue = () => {
      if (cellServiceActionQueues.get(args.queueKey) === action) {
        cellServiceActionQueues.delete(args.queueKey);
      }
    };
    action.then(clearQueue, clearQueue);
  }
  if (args.waitForAction !== false) {
    await action;
    return;
  }
  action.catch((error) => {
    args.log.error({ error, ...args.logContext }, args.errorMessage);
  });
}

function handleRouteActionError(args: {
  error: unknown;
  set: RouteSet;
  log: RouteLog;
  logContext: Record<string, unknown>;
  errorMessage: string;
}) {
  const error = unwrapSupervisorError(args.error);
  args.set.status = HTTP_STATUS.INTERNAL_ERROR;
  args.log.error({ error: args.error, ...args.logContext }, args.errorMessage);
  return {
    message: error instanceof Error ? error.message : args.errorMessage,
  } satisfies MessageResponse;
}

async function runServiceAction(args: {
  action: () => MaybePromise<void>;
  route: {
    cellId: string;
    queueAction?: boolean;
    waitForAction?: boolean;
    set: RouteSet;
    log: RouteLog;
  };
  logContext: Record<string, unknown>;
  errorMessage: string;
  backgroundErrorMessage: string;
}): Promise<MessageResponse | null> {
  try {
    await runOrDispatchServiceAction({
      action: args.action,
      queueKey: args.route.cellId,
      queueAction: args.route.queueAction,
      waitForAction: args.route.waitForAction,
      log: args.route.log,
      logContext: args.logContext,
      errorMessage: args.backgroundErrorMessage,
    });
    return null;
  } catch (error) {
    return handleRouteActionError({
      error,
      set: args.route.set,
      log: args.route.log,
      logContext: args.logContext,
      errorMessage: args.errorMessage,
    });
  }
}

const serviceActionQueueState = globalThis as typeof globalThis & {
  __hiveCellServiceActionQueues?: Map<string, Promise<void>>;
};
const cellServiceActionQueues =
  serviceActionQueueState.__hiveCellServiceActionQueues ??
  new Map<string, Promise<void>>();
serviceActionQueueState.__hiveCellServiceActionQueues = cellServiceActionQueues;

type ResolvedCellServiceAction = (
  deps: CellRouteDependencies
) => MaybePromise<void>;

type ResolvedSingleServiceAction = (
  deps: CellRouteDependencies,
  serviceId: string
) => MaybePromise<void>;

async function runCellServicesAction(args: {
  deps: CellRouteDependencies;
  cellId: string;
  set: RouteSet;
  log: RouteLog;
  request: Request;
  type: ActivityEventType;
  action: () => MaybePromise<void>;
  queueAction?: boolean;
  waitForAction?: boolean;
}): Promise<CellServiceListResponse | MessageResponse> {
  return await withCellRoute({
    deps: args.deps,
    cellId: args.cellId,
    set: args.set,
    run: async (cell) => {
      const deletionConflict = rejectDeletingCell(cell.status, args.set);
      if (deletionConflict) {
        return deletionConflict;
      }
      await recordServiceActivity(args);
      const logContext = { cellId: args.cellId, type: args.type };

      const actionError = await runServiceAction({
        action: args.action,
        route: args,
        logContext,
        errorMessage: "Cell service action failed",
        backgroundErrorMessage: "Background cell service action failed",
      });
      if (actionError) {
        return actionError;
      }
      return await serializeServicesForCell(
        args.deps,
        args.deps.db,
        args.cellId
      );
    },
  });
}

async function runSingleServiceAction(args: {
  deps: CellRouteDependencies;
  cellId: string;
  serviceId: string;
  set: RouteSet;
  log: RouteLog;
  request: Request;
  type: ActivityEventType;
  metadata?: (row: ServiceRow) => Record<string, unknown>;
  action: (serviceId: string) => MaybePromise<void>;
  queueAction?: boolean;
  waitForAction?: boolean;
}): Promise<CellServiceResponse | MessageResponse> {
  return await withServiceRoute({
    deps: args.deps,
    cellId: args.cellId,
    serviceId: args.serviceId,
    set: args.set,
    run: async (row) => {
      const deletionConflict = rejectDeletingCell(row.cell.status, args.set);
      if (deletionConflict) {
        return deletionConflict;
      }
      await recordServiceActivity({
        ...args,
        serviceId: args.serviceId,
        metadata: args.metadata?.(row) ?? {},
      });
      const logContext = {
        cellId: args.cellId,
        serviceId: args.serviceId,
        type: args.type,
      };

      const actionError = await runServiceAction({
        action: () => args.action(args.serviceId),
        route: args,
        logContext,
        errorMessage: "Service action failed",
        backgroundErrorMessage: "Background service action failed",
      });
      if (actionError) {
        return actionError;
      }
      const updated = await fetchServiceRow(
        args.deps.db,
        args.cellId,
        args.serviceId
      );
      if (!updated) {
        args.set.status = HTTP_STATUS.NOT_FOUND;
        return { message: "Service not found" } satisfies MessageResponse;
      }

      return await serializeService(args.deps, args.deps.db, updated);
    },
  });
}

const LOG_TAIL_MAX_LINES = 200;
const LOG_TAIL_API_MAX_LINES = 2000;
const LOG_LINE_SPLIT_RE = /\r?\n/;
const PORT_CHECK_TIMEOUT_MS = 500;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const SERVICES_RESOURCE_REFRESH_INTERVAL_MS = 5000;
const TERMINAL_RESIZE_MIN_COLS = 20;
const TERMINAL_RESIZE_MAX_COLS = 500;
const TERMINAL_RESIZE_MIN_ROWS = 5;
const TERMINAL_RESIZE_MAX_ROWS = 200;
const MAX_PROVISIONING_ATTEMPTS = 3;
const INITIAL_PROMPT_BACKGROUND_WARN_TIMEOUT_MS = 3000;
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL =
  process.env.SERVICE_PROTOCOL === "https" ? "https" : "http";
type OpencodeThemeMode = "dark" | "light";
const ChatThemeModeQuerySchema = t.Object({
  themeMode: t.Optional(t.Union([t.Literal("dark"), t.Literal("light")])),
});
const TerminalWsInputMessageSchema = t.Object({
  type: t.Literal("input"),
  data: t.String({ minLength: 1 }),
});
const TerminalWsResizeMessageSchema = t.Object({
  type: t.Literal("resize"),
  cols: t.Number({
    minimum: TERMINAL_RESIZE_MIN_COLS,
    maximum: TERMINAL_RESIZE_MAX_COLS,
  }),
  rows: t.Number({
    minimum: TERMINAL_RESIZE_MIN_ROWS,
    maximum: TERMINAL_RESIZE_MAX_ROWS,
  }),
});
const TerminalWsRestartMessageSchema = t.Object({
  type: t.Literal("restart"),
});
const TerminalWsPingMessageSchema = t.Object({
  type: t.Literal("ping"),
});
const TerminalWsMessageSchema = t.Union([
  TerminalWsInputMessageSchema,
  TerminalWsResizeMessageSchema,
  TerminalWsRestartMessageSchema,
  TerminalWsPingMessageSchema,
]);
type TerminalWsMessage = Static<typeof TerminalWsMessageSchema>;

const PROVISIONING_INTERRUPTED_MESSAGE =
  "Provisioning interrupted. Fix the workspace and rerun setup.";
const PROVISIONING_CANCELLED_MESSAGE =
  "Provisioning cancelled because the cell no longer exists.";

const provisioningRuntimeState = globalThis as typeof globalThis & {
  __hiveActiveProvisioningWorkflows?: Set<string>;
};
const activeProvisioningWorkflows =
  provisioningRuntimeState.__hiveActiveProvisioningWorkflows ??
  new Set<string>();
provisioningRuntimeState.__hiveActiveProvisioningWorkflows =
  activeProvisioningWorkflows;

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
} as const;

const buildServiceUrl = (
  port?: number | null,
  protocol: "http" | "https" | "tcp" = DEFAULT_SERVICE_PROTOCOL
) =>
  typeof port === "number" && protocol !== "tcp"
    ? `${protocol}://${DEFAULT_SERVICE_HOST}:${port}`
    : null;

function isPortActive(port?: number | null): Promise<boolean> {
  if (!port) {
    return Promise.resolve(false);
  }

  const probeHost = (host: string): Promise<true> =>
    new Promise((resolve, reject) => {
      const socket = createConnection({ host, port })
        .once("connect", () => {
          socket.end();
          resolve(true);
        })
        .once("error", () => {
          reject(new Error("connect_failed"));
        })
        .once("timeout", () => {
          socket.destroy();
          reject(new Error("connect_timeout"));
        });

      socket.setTimeout(PORT_CHECK_TIMEOUT_MS);
    });

  // Some services bind to IPv6 loopback (::1) when HOST/HOSTNAME is "localhost".
  // Probe both loopback families to avoid false negatives.
  return Promise.any([probeHost("127.0.0.1"), probeHost("::1")])
    .then(() => true)
    .catch(() => false);
}

function cellToResponse(cell: typeof cells.$inferSelect) {
  return {
    id: cell.id,
    name: cell.name,
    description: cell.description,
    templateId: cell.templateId,
    workspaceId: cell.workspaceId,
    workspaceRootPath: cell.workspaceRootPath,
    workspacePath: cell.workspacePath,
    opencodeSessionId: cell.opencodeSessionId,
    opencodeCommand: buildOpencodeCommand({
      workspacePath: cell.workspacePath,
      opencodeSessionId: cell.opencodeSessionId,
    }),
    createdAt: cell.createdAt.toISOString(),
    status: cell.status,
    ...(cell.lastSetupError != null
      ? { lastSetupError: cell.lastSetupError }
      : {}),
    ...(cell.branchName != null ? { branchName: cell.branchName } : {}),
    ...(cell.baseCommit != null ? { baseCommit: cell.baseCommit } : {}),
  };
}

function buildOpencodeCommand(
  cell: Pick<typeof cells.$inferSelect, "workspacePath" | "opencodeSessionId">
): string | null {
  if (!(cell.workspacePath && cell.opencodeSessionId)) {
    return null;
  }

  const serverUrl =
    process.env.HIVE_OPENCODE_SERVER_URL ?? getSharedOpencodeServerBaseUrl();
  if (!serverUrl) {
    return [
      "opencode",
      shellQuote(cell.workspacePath),
      "--session",
      shellQuote(cell.opencodeSessionId),
    ].join(" ");
  }

  const args = [
    "opencode",
    "attach",
    shellQuote(serverUrl),
    "--dir",
    shellQuote(cell.workspacePath),
    "--session",
    shellQuote(cell.opencodeSessionId),
  ];

  return args.join(" ");
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

type ChatTerminalDependencies = {
  ensureChatTerminalSession: NonNullable<
    CellRouteDependencies["ensureChatTerminalSession"]
  >;
  getChatTerminalSession: (cellId: string) => ChatTerminalSession | null;
  readChatTerminalOutput: NonNullable<
    CellRouteDependencies["readChatTerminalOutput"]
  >;
  subscribeToChatTerminal: NonNullable<
    CellRouteDependencies["subscribeToChatTerminal"]
  >;
  writeChatTerminalInput: NonNullable<
    CellRouteDependencies["writeChatTerminalInput"]
  >;
  resizeChatTerminal: NonNullable<CellRouteDependencies["resizeChatTerminal"]>;
  closeChatTerminalSession: NonNullable<
    CellRouteDependencies["closeChatTerminalSession"]
  >;
};

function getChatTerminalDependencies(
  deps: CellRouteDependencies
): ChatTerminalDependencies {
  if (
    !(
      deps.ensureChatTerminalSession &&
      deps.readChatTerminalOutput &&
      deps.subscribeToChatTerminal &&
      deps.writeChatTerminalInput &&
      deps.resizeChatTerminal &&
      deps.closeChatTerminalSession
    )
  ) {
    throw new Error("Chat terminal service is unavailable");
  }

  return {
    ensureChatTerminalSession: deps.ensureChatTerminalSession,
    getChatTerminalSession: deps.getChatTerminalSession ?? (() => null),
    readChatTerminalOutput: deps.readChatTerminalOutput,
    subscribeToChatTerminal: deps.subscribeToChatTerminal,
    writeChatTerminalInput: deps.writeChatTerminalInput,
    resizeChatTerminal: deps.resizeChatTerminal,
    closeChatTerminalSession: deps.closeChatTerminalSession,
  };
}

function normalizeOpencodeThemeMode(value?: string): OpencodeThemeMode {
  return value === "light" ? "light" : "dark";
}

const decoder = new TextDecoder();

const parseTerminalWsPayload = (raw: unknown): unknown | null => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  if (raw instanceof Uint8Array) {
    try {
      return JSON.parse(decoder.decode(raw)) as unknown;
    } catch {
      return null;
    }
  }

  if (raw instanceof ArrayBuffer) {
    try {
      return JSON.parse(decoder.decode(new Uint8Array(raw))) as unknown;
    } catch {
      return null;
    }
  }

  return raw;
};

const toBoundedInteger = (
  value: unknown,
  min: number,
  max: number
): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const next = Math.floor(value);
  if (next < min || next > max) {
    return null;
  }

  return next;
};

const parseTerminalWsMessage = (raw: unknown): TerminalWsMessage | null => {
  const payload = parseTerminalWsPayload(raw);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as {
    type?: unknown;
    data?: unknown;
    cols?: unknown;
    rows?: unknown;
  };

  if (candidate.type === "input") {
    return typeof candidate.data === "string" && candidate.data.length > 0
      ? { type: "input", data: candidate.data }
      : null;
  }

  if (candidate.type === "resize") {
    const cols = toBoundedInteger(
      candidate.cols,
      TERMINAL_RESIZE_MIN_COLS,
      TERMINAL_RESIZE_MAX_COLS
    );
    const rows = toBoundedInteger(
      candidate.rows,
      TERMINAL_RESIZE_MIN_ROWS,
      TERMINAL_RESIZE_MAX_ROWS
    );
    if (!(cols && rows)) {
      return null;
    }

    return { type: "resize", cols, rows };
  }

  if (candidate.type === "restart" || candidate.type === "ping") {
    return { type: candidate.type };
  }

  return null;
};

function normalizeStartMode(value: string | undefined): AgentMode | undefined {
  switch (value) {
    case "plan":
    case "build":
      return value;
    default:
      return;
  }
}

function normalizeSpawnFromMode(
  value: string | undefined
): "head" | "branch" | "pr" | undefined {
  if (value === "head" || value === "branch" || value === "pr") {
    return value;
  }

  return;
}

function normalizeSpawnFromValue(
  value: string | undefined
): string | undefined {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  return trimmed;
}

function resolveWorktreeStartPoint(body: {
  spawnFromMode?: string;
  spawnFromValue?: string;
}): WorktreeStartPoint {
  const mode = normalizeSpawnFromMode(body.spawnFromMode) ?? "head";
  const value = normalizeSpawnFromValue(body.spawnFromValue);

  if (mode === "head") {
    return { mode };
  }

  if (!value) {
    throw new Error(
      mode === "branch"
        ? "Branch name is required when spawning from branch"
        : "GitHub PR reference is required when spawning from PR"
    );
  }

  return { mode, value };
}

async function resolveDefaultStartMode(args: {
  workspaceRootPath: string;
  defaultsStartMode: string | undefined;
  configDefaultMode: string | undefined;
}): Promise<AgentMode> {
  const defaultsStartMode = normalizeStartMode(args.defaultsStartMode);
  if (defaultsStartMode) {
    return defaultsStartMode;
  }

  const explicitDefault = normalizeStartMode(args.configDefaultMode);
  if (explicitDefault) {
    return explicitDefault;
  }

  try {
    const effectiveDefaults = await loadEffectiveOpencodeDefaults(
      args.workspaceRootPath
    );
    if (effectiveDefaults.startMode) {
      const normalized = normalizeStartMode(effectiveDefaults.startMode);
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Ignore OpenCode config loading issues and use default fallback.
  }

  return "plan";
}

async function ensureChatTerminalSessionForCell(
  deps: CellRouteDependencies,
  cell: typeof cells.$inferSelect,
  themeMode: OpencodeThemeMode
) {
  const serverUrl =
    process.env.HIVE_OPENCODE_SERVER_URL ?? getSharedOpencodeServerBaseUrl();

  if (!serverUrl) {
    throw new Error("Shared OpenCode server is not running");
  }

  const chatTerminal = getChatTerminalDependencies(deps);
  const agentSession = await deps.ensureAgentSession(cell.id);
  const preferredProviderId =
    agentSession.modelProviderId ?? agentSession.provider;
  const startMode = agentSession.currentMode ?? agentSession.startMode;
  const preferredModel =
    agentSession.modelId && preferredProviderId
      ? {
          modelId: agentSession.modelId,
          providerId: preferredProviderId,
          ...(agentSession.modelVariant
            ? { variant: agentSession.modelVariant }
            : {}),
        }
      : undefined;
  const session = await runWithCellCleanupLock(cell.id, async () => {
    const currentCell = await requireCellAvailableForRuntime(deps.db, cell.id);
    const environment = await resolveCellTerminalEnvironment(
      deps.db,
      currentCell
    );
    return chatTerminal.ensureChatTerminalSession({
      cellId: currentCell.id,
      workspacePath: currentCell.workspacePath,
      opencodeSessionId: agentSession.id,
      opencodeServerUrl: serverUrl,
      opencodeThemeMode: themeMode,
      preferredModel,
      environment,
      ...(startMode ? { startMode } : {}),
    });
  });

  return {
    session,
    chatTerminal,
  };
}

async function resolveCellTerminalEnvironment(
  database: DatabaseClient,
  cell: typeof cells.$inferSelect
): Promise<Record<string, string>> {
  const persistedPorts = await database
    .select({
      serviceName: cellServices.name,
      portName: cellServicePorts.name,
      port: cellServicePorts.port,
      primary: cellServicePorts.primary,
    })
    .from(cellServicePorts)
    .innerJoin(cellServices, eq(cellServices.id, cellServicePorts.serviceId))
    .where(eq(cellServices.cellId, cell.id));

  return {
    ...resolveCellEnvironment(cell.id, cell.workspacePath),
    ...buildPersistedCellPortEnvironment(persistedPorts),
  };
}

async function ensureCellTerminalSessionForCell(
  deps: CellRouteDependencies,
  cell: typeof cells.$inferSelect
): Promise<CellTerminalSession> {
  return await runWithCellCleanupLock(cell.id, async () => {
    const currentCell = await requireCellAvailableForRuntime(deps.db, cell.id);
    return deps.ensureTerminalSession({
      cellId: currentCell.id,
      workspacePath: currentCell.workspacePath,
      environment: await resolveCellTerminalEnvironment(deps.db, currentCell),
    });
  });
}

function isCellReadyForChat(cell: typeof cells.$inferSelect): boolean {
  return cell.status === "ready";
}

async function withChatTerminalRoute<T>(args: {
  deps: CellRouteDependencies;
  cellId: string;
  themeMode: OpencodeThemeMode;
  set: RouteSet;
  log: RouteLog;
  errorMessage: string;
  run: (
    cell: typeof cells.$inferSelect,
    prepared: Awaited<ReturnType<typeof ensureChatTerminalSessionForCell>>
  ) => MaybePromise<T>;
}): Promise<T | MessageResponse> {
  return await withSafeCellRoute({
    deps: args.deps,
    cellId: args.cellId,
    set: args.set,
    log: args.log,
    errorMessage: args.errorMessage,
    run: async (cell) => {
      if (!isCellReadyForChat(cell)) {
        args.set.status = HTTP_STATUS.CONFLICT;
        return {
          message: "Chat terminal is unavailable until provisioning completes",
        } satisfies MessageResponse;
      }

      const prepared = await ensureChatTerminalSessionForCell(
        args.deps,
        cell,
        args.themeMode
      );
      return await args.run(cell, prepared);
    },
  });
}

function withSafeCellRoute<T>(args: {
  deps: CellRouteDependencies;
  cellId: string;
  set: RouteSet;
  log: RouteLog;
  errorMessage: string;
  run: (cell: typeof cells.$inferSelect) => MaybePromise<T>;
}): Promise<T | MessageResponse> {
  return withCellRoute({
    cellId: args.cellId,
    deps: args.deps,
    run: (cell) => runSafeCellHandler(args, cell),
    set: args.set,
  });
}

async function runSafeCellHandler<T>(
  args: {
    set: RouteSet;
    log: RouteLog;
    errorMessage: string;
    run: (cell: typeof cells.$inferSelect) => MaybePromise<T>;
  },
  cell: typeof cells.$inferSelect
): Promise<T | MessageResponse> {
  try {
    return await args.run(cell);
  } catch (error) {
    args.set.status = HTTP_STATUS.INTERNAL_ERROR;
    args.log.error({ error, cellId: cell.id }, args.errorMessage);
    return {
      message: error instanceof Error ? error.message : args.errorMessage,
    } satisfies MessageResponse;
  }
}

const withCellTerminalRoute = withSafeCellRoute;

type TerminalRouteSocketContext = {
  params: {
    id: string;
    serviceId?: string;
  };
  query?: {
    themeMode?: string;
  };
};

type TerminalRouteSocket = {
  id: string;
  data: TerminalRouteSocketContext;
  send: (message: unknown) => unknown;
  close: () => void;
};

type TerminalStreamEvent =
  | {
      type: "data";
      chunk: string;
    }
  | {
      type: "session";
      session: ServiceTerminalSession;
    }
  | {
      type: "exit";
      exitCode: number | null;
      signal: string | number | null;
    };

type SetupTerminalWsState = {
  kind: "setup";
  deps: CellRouteDependencies;
  cellId: string;
};

type ServiceTerminalWsState = {
  kind: "service";
  deps: CellRouteDependencies;
  serviceId: string;
};

type CellTerminalWsState = {
  kind: "cell";
  deps: CellRouteDependencies;
  cell: typeof cells.$inferSelect;
};

type ChatTerminalWsState = {
  kind: "chat";
  deps: CellRouteDependencies;
  cell: typeof cells.$inferSelect;
  themeMode: OpencodeThemeMode;
  chatTerminal: ChatTerminalDependencies;
};

type TerminalWsState =
  | SetupTerminalWsState
  | ServiceTerminalWsState
  | CellTerminalWsState
  | ChatTerminalWsState;

type TerminalWsActions<Kind extends TerminalWsState["kind"]> = {
  input: (
    state: Extract<TerminalWsState, { kind: Kind }>,
    data: string
  ) => MaybePromise<void>;
  resize: (
    state: Extract<TerminalWsState, { kind: Kind }>,
    cols: number,
    rows: number
  ) => MaybePromise<void>;
  restart?: (
    state: Extract<TerminalWsState, { kind: Kind }>
  ) => MaybePromise<void>;
};

type TerminalSessionLike = { status: string };

const sendWsError = (ws: TerminalRouteSocket, message: string) => {
  ws.send({ type: "error", message });
};

const sendWsErrorAndClose = (ws: TerminalRouteSocket, message: string) => {
  sendWsError(ws, message);
  ws.close();
};

async function loadCellForWs(
  deps: CellRouteDependencies,
  ws: TerminalRouteSocket
): Promise<typeof cells.$inferSelect | null> {
  const cell = await loadCellById(deps.db, ws.data.params.id);
  if (!cell) {
    sendWsErrorAndClose(ws, "Cell not found");
    return null;
  }

  return cell;
}

async function loadServiceRowForWs(
  deps: CellRouteDependencies,
  ws: TerminalRouteSocket
): Promise<ServiceRow | null> {
  const row = await fetchServiceRow(
    deps.db,
    ws.data.params.id,
    ws.data.params.serviceId ?? ""
  );
  if (!row) {
    sendWsErrorAndClose(ws, "Service not found");
    return null;
  }

  return row;
}

async function* createTerminalEventStream(args: {
  readyData: unknown;
  sessionReadyData?: (session: ServiceTerminalSession) => unknown;
  initialOutput: string;
  iterator: AsyncIterable<TerminalStreamEvent>;
  cleanup: () => void;
}) {
  try {
    yield sse({ event: "ready", data: args.readyData });

    if (args.initialOutput.length > 0) {
      yield sse({ event: "snapshot", data: { output: args.initialOutput } });
    }

    for await (const event of args.iterator) {
      if (event.type === "session") {
        yield sse({
          event: "ready",
          data: args.sessionReadyData?.(event.session) ?? event.session,
        });
        continue;
      }
      if (event.type === "data") {
        yield sse({ event: "data", data: { chunk: event.chunk } });
        continue;
      }

      yield sse({
        event: "exit",
        data: {
          exitCode: event.exitCode,
          signal: event.signal,
        },
      });
    }
  } finally {
    args.cleanup();
  }
}

const createSessionTerminalEventStream = (args: {
  session: unknown;
  initialOutput: string;
  iterator: AsyncIterable<TerminalStreamEvent>;
  cleanup: () => void;
}) =>
  createTerminalEventStream({
    readyData: args.session,
    initialOutput: args.initialOutput,
    iterator: args.iterator,
    cleanup: args.cleanup,
  });

const wrappedTerminalSessionReadyData = (session: ServiceTerminalSession) => ({
  session,
});

const forwardTerminalEventToWs = (
  ws: TerminalRouteSocket,
  event: TerminalStreamEvent
) => {
  if (event.type === "session") {
    ws.send({ type: "ready", session: event.session });
    return;
  }
  if (event.type === "data") {
    ws.send({ type: "data", chunk: event.chunk });
    return;
  }

  ws.send({ type: "exit", exitCode: event.exitCode, signal: event.signal });
};

const sendTerminalSnapshotToWs = (
  ws: TerminalRouteSocket,
  initialOutput: string
) => {
  if (initialOutput.length > 0) {
    ws.send({ type: "snapshot", output: initialOutput });
  }
};

const handleSetupTerminalWsInput = (args: {
  deps: CellRouteDependencies;
  ws: TerminalRouteSocket;
  cellId: string;
  data: string;
}) => {
  const { deps, ws, cellId, data } = args;
  const session = deps.getSetupTerminalSession(cellId);
  if (!session || session.status !== "running") {
    sendWsError(ws, "Setup terminal session not available");
    return;
  }

  deps.writeSetupTerminalInput(cellId, data);
};

const handleSetupTerminalWsResize = (args: {
  deps: CellRouteDependencies;
  ws: TerminalRouteSocket;
  cellId: string;
  cols: number;
  rows: number;
}) => {
  const { deps, ws, cellId, cols, rows } = args;
  deps.resizeSetupTerminal(cellId, cols, rows);
  const session = deps.getSetupTerminalSession(cellId);
  if (session) {
    ws.send({ type: "ready", session });
  }
};

const handleServiceTerminalWsInput = (args: {
  deps: CellRouteDependencies;
  ws: TerminalRouteSocket;
  serviceId: string;
  data: string;
}) => {
  const { deps, ws, serviceId, data } = args;
  const session = deps.getServiceTerminalSession(serviceId);
  if (!session || session.status !== "running") {
    sendWsError(ws, "Service terminal session not available");
    return;
  }

  deps.writeServiceTerminalInput(serviceId, data);
};

const handleServiceTerminalWsResize = (args: {
  deps: CellRouteDependencies;
  ws: TerminalRouteSocket;
  serviceId: string;
  cols: number;
  rows: number;
}) => {
  const { deps, ws, serviceId, cols, rows } = args;
  deps.resizeServiceTerminal(serviceId, cols, rows);
  const session = deps.getServiceTerminalSession(serviceId);
  if (session) {
    ws.send({ type: "ready", session });
  }
};

const handleCellTerminalWsInput = (args: {
  deps: CellRouteDependencies;
  cellId: string;
  data: string;
}) => {
  const { deps, cellId, data } = args;
  deps.writeTerminalInput(cellId, data);
};

const handleCellTerminalWsResize = async (args: {
  deps: CellRouteDependencies;
  ws: TerminalRouteSocket;
  cell: typeof cells.$inferSelect;
  cols: number;
  rows: number;
}) => {
  const { deps, ws, cell, cols, rows } = args;
  const session = await ensureCellTerminalSessionForCell(deps, cell);
  deps.resizeTerminal(cell.id, cols, rows);
  ws.send({
    type: "ready",
    session: {
      ...session,
      cols,
      rows,
    },
  });
};

function runTerminalInputAction(args: {
  set: RouteSet;
  log: RouteLog;
  logContext: Record<string, unknown>;
  unavailableMessage: string;
  errorMessage: string;
  getSession: () => TerminalSessionLike | null;
  write: () => void;
}) {
  const session = args.getSession();
  if (!session || session.status !== "running") {
    args.set.status = HTTP_STATUS.CONFLICT;
    return { message: args.unavailableMessage } satisfies MessageResponse;
  }

  try {
    args.write();
    return { ok: true };
  } catch (error) {
    return handleRouteActionError({ ...args, error });
  }
}

function buildTerminalResizeResponse<Session>(
  session: Session,
  cols: number,
  rows: number
) {
  return { ok: true, session: { ...session, cols, rows } };
}

function runTerminalResizeAction<Session>(args: {
  set: RouteSet;
  log: RouteLog;
  logContext: Record<string, unknown>;
  unavailableMessage: string;
  errorMessage: string;
  resize: () => void;
  getSession: () => Session | null;
}) {
  try {
    args.resize();
    const session = args.getSession();
    if (!session) {
      args.set.status = HTTP_STATUS.CONFLICT;
      return { message: args.unavailableMessage } satisfies MessageResponse;
    }

    return { ok: true, session };
  } catch (error) {
    return handleRouteActionError({ ...args, error });
  }
}

type ErrorPayload = {
  message: string;
  details?: string;
};

export function createCellsRoutes(
  overrides: Partial<CellRouteDependencies> = {}
) {
  const resolveDeps = (() => {
    let cachedDeps: Promise<CellRouteDependencies> | null = null;
    return () => {
      if (!cachedDeps) {
        cachedDeps = resolveCellRouteDependencies(overrides);
      }
      return cachedDeps;
    };
  })();

  const workspaceContextPlugin = createWorkspaceContextPlugin({
    resolveWorkspaceContext: async (workspaceId) => {
      const deps = await resolveDeps();
      return await resolveWorkspaceContextFromDeps(
        deps.resolveWorkspaceContext,
        workspaceId
      );
    },
  });

  const wsCleanupById = new Map<string, () => void>();
  const wsStateById = new Map<string, TerminalWsState>();

  const registerWsCleanup = (socketId: string, cleanup: () => void) => {
    const existing = wsCleanupById.get(socketId);
    existing?.();
    wsCleanupById.set(socketId, cleanup);
  };

  const setWsState = (socketId: string, state: TerminalWsState) => {
    wsStateById.set(socketId, state);
  };

  const getWsState = <Kind extends TerminalWsState["kind"]>(
    socketId: string,
    kind: Kind
  ): Extract<TerminalWsState, { kind: Kind }> | null => {
    const state = wsStateById.get(socketId);
    if (!state || state.kind !== kind) {
      return null;
    }

    return state as Extract<TerminalWsState, { kind: Kind }>;
  };

  const handleTerminalWsMessage = async <Kind extends TerminalWsState["kind"]>(
    ws: TerminalRouteSocket,
    rawMessage: unknown,
    kind: Kind,
    handler: (
      state: Extract<TerminalWsState, { kind: Kind }>,
      message: TerminalWsMessage
    ) => void | Promise<void>
  ) => {
    const message = parseTerminalWsMessage(rawMessage);
    if (!message) {
      sendWsError(ws, "Invalid websocket message");
      return;
    }

    const state = getWsState(ws.id, kind);
    if (!state) {
      sendWsError(ws, "Terminal websocket session is unavailable");
      ws.close();
      return;
    }

    try {
      await handler(state, message);
    } catch (error) {
      sendWsError(
        ws,
        error instanceof Error
          ? error.message
          : "Failed to process terminal websocket message"
      );
    }
  };

  const handleTerminalWsControlMessage = async <
    Kind extends TerminalWsState["kind"],
  >(
    ws: TerminalRouteSocket,
    rawMessage: unknown,
    kind: Kind,
    actions: TerminalWsActions<Kind>
  ) => {
    await handleTerminalWsMessage(
      ws,
      rawMessage,
      kind,
      async (state, message) => {
        if (message.type === "ping") {
          ws.send({ type: "pong" });
          return;
        }

        if (message.type === "input") {
          await actions.input(state, message.data);
          return;
        }

        if (message.type === "resize") {
          await actions.resize(state, message.cols, message.rows);
          return;
        }

        if (actions.restart) {
          await actions.restart(state);
          return;
        }

        sendWsError(ws, "Restart is unsupported");
      }
    );
  };

  const withResolvedCellRoute = async <T>(args: {
    cellId: string;
    set: RouteSet;
    run: (
      cell: typeof cells.$inferSelect,
      deps: CellRouteDependencies
    ) => MaybePromise<T>;
  }) => {
    const deps = await resolveDeps();
    return withCellRoute({
      cellId: args.cellId,
      deps,
      run(cell) {
        return args.run(cell, deps);
      },
      set: args.set,
    });
  };

  const withResolvedServiceRoute = async <T>(args: {
    cellId: string;
    serviceId: string;
    set: RouteSet;
    run: (row: ServiceRow, deps: CellRouteDependencies) => MaybePromise<T>;
  }) => {
    const deps = await resolveDeps();
    return await withServiceRoute({
      deps,
      cellId: args.cellId,
      serviceId: args.serviceId,
      set: args.set,
      run: (row) => args.run(row, deps),
    });
  };

  const withResolvedCellTerminalRoute = async <T>(args: {
    cellId: string;
    set: RouteSet;
    log: RouteLog;
    errorMessage: string;
    run: (
      cell: typeof cells.$inferSelect,
      deps: CellRouteDependencies
    ) => MaybePromise<T>;
  }) => {
    const runtimeDeps = await resolveDeps();
    return withCellTerminalRoute({
      cellId: args.cellId,
      deps: runtimeDeps,
      errorMessage: args.errorMessage,
      log: args.log,
      run(cell) {
        return args.run(cell, runtimeDeps);
      },
      set: args.set,
    });
  };

  const withResolvedChatTerminalRoute = async <T>(args: {
    cellId: string;
    themeMode: OpencodeThemeMode;
    set: RouteSet;
    log: RouteLog;
    errorMessage: string;
    run: (
      cell: typeof cells.$inferSelect,
      prepared: Awaited<ReturnType<typeof ensureChatTerminalSessionForCell>>,
      deps: CellRouteDependencies
    ) => MaybePromise<T>;
  }) => {
    const deps = await resolveDeps();
    return await withChatTerminalRoute({
      deps,
      cellId: args.cellId,
      themeMode: args.themeMode,
      set: args.set,
      log: args.log,
      errorMessage: args.errorMessage,
      run: (cell, prepared) => args.run(cell, prepared, deps),
    });
  };

  const withResolvedServiceAction = async <T>(
    run: (deps: CellRouteDependencies) => MaybePromise<T>
  ): Promise<T> => {
    const deps = await resolveDeps();
    return await run(deps);
  };

  const runResolvedCellServicesAction = async (args: {
    cellId: string;
    set: RouteSet;
    log: RouteLog;
    request: Request;
    type: ActivityEventType;
    action: ResolvedCellServiceAction;
    queueAction?: boolean;
    waitForAction?: boolean;
  }) =>
    await withResolvedServiceAction(async (deps) =>
      runCellServicesAction({
        deps,
        cellId: args.cellId,
        set: args.set,
        log: args.log,
        request: args.request,
        type: args.type,
        action: () => args.action(deps),
        queueAction: args.queueAction,
        waitForAction: args.waitForAction,
      })
    );

  const handleBulkServiceRoute = async (
    context: {
      params: { id: string };
      set: RouteSet;
      request: Request;
      log: RouteLog;
    },
    action: {
      type: ActivityEventType;
      run: ResolvedCellServiceAction;
      queueAction?: boolean;
      waitForAction?: boolean;
    }
  ) =>
    await runResolvedCellServicesAction({
      cellId: context.params.id,
      set: context.set,
      log: context.log,
      request: context.request,
      type: action.type,
      action: action.run,
      queueAction: action.queueAction,
      waitForAction: action.waitForAction,
    });

  const runResolvedSingleServiceAction = async (args: {
    cellId: string;
    serviceId: string;
    set: RouteSet;
    log: RouteLog;
    request: Request;
    server?: { timeout: (request: Request, seconds: number) => void } | null;
    type: ActivityEventType;
    metadata?: (row: ServiceRow) => Record<string, unknown>;
    action: ResolvedSingleServiceAction;
    queueAction?: boolean;
    waitForAction?: boolean;
  }) => {
    args.server?.timeout(args.request, 0);
    return await withResolvedServiceAction(async (deps) =>
      runSingleServiceAction({
        deps,
        cellId: args.cellId,
        serviceId: args.serviceId,
        set: args.set,
        log: args.log,
        request: args.request,
        type: args.type,
        metadata: args.metadata,
        action: (serviceId) => args.action(deps, serviceId),
        queueAction: args.queueAction,
        waitForAction: args.waitForAction,
      })
    );
  };

  const openTerminalWs = (args: {
    ws: TerminalRouteSocket;
    unsubscribe: () => void;
    state: TerminalWsState;
    readyPayload: Record<string, unknown>;
    initialOutput: string;
  }) => {
    registerWsCleanup(args.ws.id, args.unsubscribe);
    setWsState(args.ws.id, args.state);
    args.ws.send({ type: "ready", ...args.readyPayload });
    sendTerminalSnapshotToWs(args.ws, args.initialOutput);
  };

  const runWsCleanup = (socketId: string) => {
    const cleanup = wsCleanupById.get(socketId);
    cleanup?.();
    wsCleanupById.delete(socketId);
    wsStateById.delete(socketId);
  };

  const openSetupTerminalSocket = async (ws: TerminalRouteSocket) => {
    const deps = await resolveDeps();
    const cell = await loadCellForWs(deps, ws);
    if (!cell) {
      return;
    }

    const session = deps.getSetupTerminalSession(cell.id);
    const setupState = deriveSetupTerminalState(cell, session);
    openTerminalWs({
      ws,
      unsubscribe: deps.subscribeToSetupTerminal(cell.id, (event) => {
        forwardTerminalEventToWs(ws, event);
      }),
      state: { kind: "setup", deps, cellId: cell.id },
      readyPayload: {
        session,
        setupState,
        lastSetupError: cell.lastSetupError,
      },
      initialOutput: deps.readSetupTerminalOutput(cell.id),
    });
  };

  const openServiceTerminalSocket = async (ws: TerminalRouteSocket) => {
    const deps = await resolveDeps();
    const row = await loadServiceRowForWs(deps, ws);
    if (!row) {
      return;
    }

    openTerminalWs({
      ws,
      unsubscribe: deps.subscribeToServiceTerminal(row.service.id, (event) => {
        forwardTerminalEventToWs(ws, event);
      }),
      state: { kind: "service", deps, serviceId: row.service.id },
      readyPayload: { session: deps.getServiceTerminalSession(row.service.id) },
      initialOutput: deps.readServiceTerminalOutput(row.service.id),
    });
  };

  const openCellTerminalSocket = async (ws: TerminalRouteSocket) => {
    const terminalDeps = await resolveDeps();
    const cell = await loadCellForWs(terminalDeps, ws);
    if (cell === null) {
      return;
    }

    let session: CellTerminalSession;
    try {
      session = await ensureCellTerminalSessionForCell(terminalDeps, cell);
    } catch (error) {
      sendWsErrorAndClose(
        ws,
        error instanceof Error
          ? error.message
          : "Failed to initialize terminal session"
      );
      return;
    }

    openTerminalWs({
      ws,
      unsubscribe: terminalDeps.subscribeToTerminal(cell.id, (event) => {
        forwardTerminalEventToWs(ws, event);
      }),
      state: {
        kind: "cell",
        deps: terminalDeps,
        cell,
      },
      readyPayload: { session },
      initialOutput: terminalDeps.readTerminalOutput(cell.id),
    });
  };

  const resolveDeletionRuntime = async () => {
    const deps = await resolveDeps();
    return {
      deletionDependencies: buildDeletionDependencies(deps),
      resolveWorkspace: deps.resolveWorkspaceContext,
    };
  };

  const handleSetupTerminalSocketMessage = (
    ws: TerminalRouteSocket,
    rawMessage: unknown
  ) =>
    handleTerminalWsControlMessage(ws, rawMessage, "setup", {
      input: (state, data) =>
        handleSetupTerminalWsInput({
          deps: state.deps,
          ws,
          cellId: state.cellId,
          data,
        }),
      resize: (state, cols, rows) =>
        handleSetupTerminalWsResize({
          deps: state.deps,
          ws,
          cellId: state.cellId,
          cols,
          rows,
        }),
    });

  const handleServiceTerminalSocketMessage = (
    ws: TerminalRouteSocket,
    rawMessage: unknown
  ) =>
    handleTerminalWsControlMessage(ws, rawMessage, "service", {
      input: (state, data) =>
        handleServiceTerminalWsInput({
          deps: state.deps,
          ws,
          serviceId: state.serviceId,
          data,
        }),
      resize: (state, cols, rows) =>
        handleServiceTerminalWsResize({
          deps: state.deps,
          ws,
          serviceId: state.serviceId,
          cols,
          rows,
        }),
    });

  const restartChatTerminalSocket = async (
    ws: TerminalRouteSocket,
    state: ChatTerminalWsState
  ) => {
    state.chatTerminal.closeChatTerminalSession(state.cell.id);
    const restarted = await ensureChatTerminalSessionForCell(
      state.deps,
      state.cell,
      state.themeMode
    );
    setWsState(ws.id, { ...state, chatTerminal: restarted.chatTerminal });
    ws.send({ type: "ready", session: restarted.session });
    ws.send({
      type: "snapshot",
      output: restarted.chatTerminal.readChatTerminalOutput(state.cell.id),
    });
  };

  const restartCellTerminalSocket = async (
    ws: TerminalRouteSocket,
    state: CellTerminalWsState
  ) => {
    state.deps.closeTerminalSession(state.cell.id);
    const session = await ensureCellTerminalSessionForCell(
      state.deps,
      state.cell
    );
    ws.send({ type: "ready", session });
    ws.send({
      type: "snapshot",
      output: state.deps.readTerminalOutput(state.cell.id),
    });
  };

  return new Elysia({ prefix: "/api/cells" })
    .use(logger({ ...LOGGER_CONFIG }))
    .use(workspaceContextPlugin)
    .post(
      "/:id/setup/retry",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const resolvedCell = resolveSetupRetryCell(
          await loadCellById(deps.db, params.id)
        );
        if (!resolvedCell.ok) {
          set.status = resolvedCell.status;
          return { message: resolvedCell.message } satisfies {
            message: string;
          };
        }
        const cell = resolvedCell.cell;

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database: deps.db,
          cellId: cell.id,
          type: "setup.retry",
          source: audit.source,
          toolName: audit.toolName,
          metadata: { templateId: cell.templateId },
        });

        const workspaceContext = await resolveWorkspaceContextFromDeps(
          deps.resolveWorkspaceContext,
          cell.workspaceId
        );
        const hiveConfig = await workspaceContext.loadConfig();
        const template = hiveConfig.templates[cell.templateId];
        if (!template) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Template not found for cell" } satisfies {
            message: string;
          };
        }

        try {
          const [provisioningState] = await deps.db
            .insert(cellProvisioningStates)
            .values({
              cellId: cell.id,
              modelIdOverride: null,
              providerIdOverride: null,
              variantOverride: null,
              startMode: "build",
              startedAt: null,
              finishedAt: null,
              attemptCount: 0,
            })
            .onConflictDoNothing({ target: cellProvisioningStates.cellId })
            .returning();

          const existingProvisioningState =
            provisioningState ??
            (await deps.db.query.cellProvisioningStates.findFirst({
              where: eq(cellProvisioningStates.cellId, cell.id),
            })) ??
            null;

          await updateCellStatusAndEmit({
            database: deps.db,
            cell,
            status: "spawning",
            lastSetupError: null,
          });

          const context = createExistingProvisionContext({
            cell: {
              ...cell,
              status: "spawning",
              lastSetupError: null,
            },
            provisioningState: existingProvisioningState,
            body: resolveProvisioningParams(cell, existingProvisioningState),
            template,
            database: deps.db,
            ensureSession: deps.ensureAgentSession,
            sendAgentMessage: deps.sendAgentMessage,
            ensureServices: deps.ensureServicesForCell,
            stopCellServices: deps.stopServicesForCell,
            runCellTeardown: deps.runCellTeardown,
            workspaceContext,
            log: backgroundProvisioningLogger,
          });

          const started = startProvisioningWorkflow(context);
          if (!started) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message: "Provisioning retry already in progress",
            } satisfies ErrorPayload;
          }
        } catch (error) {
          const payload = buildCellCreationErrorPayload(error);
          const lastSetupError = deriveSetupErrorDetails(payload);
          await updateCellStatusAndEmit({
            database: deps.db,
            cell,
            status: "error",
            lastSetupError,
          });

          set.status = HTTP_STATUS.BAD_REQUEST;
          return {
            message: payload.message,
            ...(lastSetupError ? { details: lastSetupError } : {}),
          } satisfies ErrorPayload;
        }

        const updated = await loadCellById(deps.db, cell.id);
        if (!updated) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return {
            message: "Failed to load cell after retry",
          } satisfies ErrorPayload;
        }

        const extras = buildSetupLogPayload(updated.id, deps);
        return {
          ...cellToResponse(updated),
          ...extras,
        } satisfies CellResponse;
      },
      {
        params: CellIdParamsSchema,
        response: {
          200: CellResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      }
    )

    .get(
      "/",
      async ({ query, set, getWorkspaceContext }) => {
        try {
          const { db: database } = await resolveDeps();
          const workspaceContext = await getWorkspaceContext(query.workspaceId);
          const allCells = await database
            .select()
            .from(cells)
            .where(
              and(
                eq(cells.workspaceId, workspaceContext.workspace.id),
                ne(cells.status, "deleting")
              )
            );
          return { cells: allCells.map(cellToResponse) };
        } catch (error) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return {
            message:
              error instanceof Error ? error.message : "Failed to load cells",
          };
        }
      },
      {
        query: t.Object({
          workspaceId: t.Optional(t.String()),
        }),
        response: {
          200: CellListResponseSchema,
          400: ErrorResponseSchema,
        },
      }
    )
    .get(
      "/workspace/:workspaceId/stream",
      async ({ params, set, getWorkspaceContext, log, request }) => {
        let workspaceContext: WorkspaceRuntimeContext;
        try {
          workspaceContext = await getWorkspaceContext(params.workspaceId);
        } catch {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Workspace not found" };
        }

        const workspaceId = workspaceContext.workspace.id;
        const { db: database } = await resolveDeps();

        const { iterator, cleanup } = createAsyncEventIterator<CellStatusEvent>(
          (handler) => subscribeToCellStatusEvents(workspaceId, handler),
          request.signal
        );

        async function* stream() {
          try {
            yield sse({ event: "ready", data: { timestamp: Date.now() } });

            const initialCells = await database
              .select()
              .from(cells)
              .where(
                and(
                  eq(cells.workspaceId, workspaceId),
                  ne(cells.status, "deleting")
                )
              );

            for (const cell of initialCells) {
              yield sse({ event: "cell", data: cellToResponse(cell) });
            }

            yield sse({ event: "snapshot", data: { timestamp: Date.now() } });

            for await (const event of iterator) {
              const streamEvent = await resolveWorkspaceCellStreamEvent({
                database,
                event,
                log,
              });
              if (!streamEvent) {
                continue;
              }

              yield sse(streamEvent);
            }
          } finally {
            cleanup();
          }
        }

        return stream();
      },
      {
        params: t.Object({ workspaceId: t.String() }),
        response: {
          200: t.Any(),
          404: MessageResponseSchema,
        },
      }
    )
    .get(
      "/:id",
      async ({ params, query, set, request }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const result = await database
          .select()
          .from(cells)
          .where(eq(cells.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
        }

        const [cell] = result;
        if (!cell) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to load cell" };
        }

        if (cell.status === "deleting") {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
        }

        const audit = readHiveAuditHeaders(request);
        if (audit.auditEvent === "setup.logs.read") {
          await insertCellActivityEvent({
            database,
            cellId: cell.id,
            type: "setup.logs.read",
            source: audit.source,
            toolName: audit.toolName,
            metadata: {},
          });
        }

        const includeSetupLog = query.includeSetupLog ?? true;
        const extras = includeSetupLog
          ? buildSetupLogPayload(cell.id, deps)
          : {};
        return { ...cellToResponse(cell), ...extras };
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        query: t.Object({
          includeSetupLog: t.Optional(t.Boolean()),
        }),
        response: {
          200: CellResponseSchema,
          404: t.Object({
            message: t.String(),
          }),
        },
      }
    )
    .get(
      "/:id/services",
      async ({ params, query, set, request }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        return await withCellRoute({
          deps,
          cellId: params.id,
          set,
          run: async () => {
            const logOptions: LogTailOptions = {
              lines: query.logLines,
              offset: query.logOffset,
            };
            const includeResources = query.includeResources ?? false;

            const rows = await fetchServiceRows(database, params.id);
            const resourcesByPid = includeResources
              ? await sampleServiceResources(deps, rows)
              : new Map<number, ProcessResourceSnapshot>();
            const services = await Promise.all(
              rows.map((row) =>
                serializeService(deps, database, row, {
                  logOptions,
                  includeResources,
                  resourcesByPid,
                })
              )
            );

            const audit = readHiveAuditHeaders(request);
            if (audit.auditEvent === "service.logs.read" && audit.serviceName) {
              const matchedRow = rows.find(
                (row) => row.service.name === audit.serviceName
              );
              await insertCellActivityEvent({
                database,
                cellId: params.id,
                serviceId: matchedRow?.service.id ?? null,
                type: "service.logs.read",
                source: audit.source,
                toolName: audit.toolName,
                metadata: {
                  serviceName: audit.serviceName,
                  logLines: query.logLines,
                  logOffset: query.logOffset,
                },
              });
            }

            return { services } satisfies CellServiceListResponse;
          },
        });
      },
      {
        params: CellIdParamsSchema,
        query: ServiceLogQuerySchema,
        response: {
          200: CellServiceListResponseSchema,
          ...StandardCellErrorResponses,
        },
      }
    )

    .get(
      "/:id/activity",
      async ({ params, query, set }) =>
        await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: async (_cell, deps) => {
            const { db: database } = deps;

            const limit = normalizeActivityLimit(query.limit);
            const types = normalizeActivityTypes(query.types);

            let cursor: { createdAt: Date; id: string } | null = null;
            if (query.cursor) {
              try {
                cursor = parseActivityCursor(query.cursor);
              } catch {
                set.status = HTTP_STATUS.BAD_REQUEST;
                return {
                  message: "Invalid cursor",
                } satisfies { message: string };
              }
            }

            const page = await fetchCellActivityPage({
              database,
              cellId: params.id,
              limit,
              types,
              cursor,
            });

            return page satisfies CellActivityEventListResponse;
          },
        }),
      {
        params: CellIdParamsSchema,
        query: t.Object({
          limit: t.Optional(
            t.Number({
              minimum: 1,
              maximum: MAX_ACTIVITY_LIMIT,
              default: DEFAULT_ACTIVITY_LIMIT,
              description: "Max events to return (1-200)",
            })
          ),
          cursor: t.Optional(t.String()),
          types: t.Optional(
            t.String({
              description:
                "Optional comma-separated list of activity types to include",
            })
          ),
        }),
        response: {
          200: CellActivityEventListResponseSchema,
          ...StandardCellErrorResponses,
        },
      }
    )

    .get(
      "/:id/timings",
      async ({ params, query, set }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        const workflow = normalizeTimingWorkflow(query.workflow);
        const limit = normalizeTimingLimit(query.limit);

        const steps = await fetchTimingSteps({
          database,
          cellId: params.id,
          workflow,
          runId: query.runId,
        });

        if (!cell && steps.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return {
            message: "Cell not found",
          } satisfies { message: string };
        }

        return toTimingListResponse(steps, limit);
      },
      {
        params: CellIdParamsSchema,
        query: t.Object({
          limit: t.Optional(
            t.Number({
              minimum: 1,
              maximum: MAX_TIMING_LIMIT,
              default: DEFAULT_TIMING_LIMIT,
            })
          ),
          workflow: t.Optional(t.Literal("create")),
          runId: t.Optional(t.String()),
        }),
        response: {
          200: CellTimingListResponseSchema,
          404: MessageResponseSchema,
        },
      }
    )
    .get(
      "/:id/timings/stream",
      async ({ params, query, request, set }) =>
        await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: () => {
            const workflow = normalizeTimingWorkflow(query.workflow);
            const { iterator, cleanup } =
              createAsyncEventIterator<CellTimingEvent>(
                (listener) => subscribeToCellTimingEvents(params.id, listener),
                request.signal
              );

            async function* stream() {
              try {
                yield sse({ event: "ready", data: { timestamp: Date.now() } });
                yield sse({
                  event: "snapshot",
                  data: { timestamp: Date.now() },
                });

                for await (const event of iterator) {
                  if (workflow && event.workflow !== workflow) {
                    continue;
                  }

                  yield sse({ event: "timing", data: event });
                }
              } finally {
                cleanup();
              }
            }

            return stream();
          },
        }),
      {
        params: CellIdParamsSchema,
        query: t.Object({
          workflow: t.Optional(t.Literal("create")),
        }),
        response: {
          200: t.Any(),
          404: MessageResponseSchema,
        },
      }
    )
    .get(
      "/:id/services/stream",
      async ({ params, query, set, log }) => {
        const includeResources = query.includeResources ?? false;
        return await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: (_cell, deps) => {
            const { db: database } = deps;

            const encoder = new TextEncoder();
            let cleanup: (() => void) | undefined;

            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                const sendEvent = (event: string, data: string) => {
                  controller.enqueue(encoder.encode(`event: ${event}\n`));
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                };

                const pushSnapshot = async (serviceId: string) => {
                  try {
                    const row = await fetchServiceRow(
                      database,
                      params.id,
                      serviceId
                    );
                    if (!row) {
                      return;
                    }
                    const resourcesByPid = includeResources
                      ? await sampleServiceResources(deps, [row])
                      : new Map<number, ProcessResourceSnapshot>();
                    const payload = await serializeService(
                      deps,
                      database,
                      row,
                      {
                        includeResources,
                        resourcesByPid,
                      }
                    );
                    sendEvent("service", JSON.stringify(payload));
                  } catch (error) {
                    log.error(
                      { error, serviceId },
                      "Failed to stream service update"
                    );
                  }
                };

                const unsubscribe = subscribeToServiceEvents(
                  params.id,
                  (event) => {
                    pushSnapshot(event.serviceId).catch(() => {
                      /* errors already logged inside pushSnapshot */
                    });
                  }
                );

                const heartbeat = setInterval(() => {
                  sendEvent("heartbeat", JSON.stringify(Date.now()));
                }, SSE_HEARTBEAT_INTERVAL_MS);

                sendEvent("ready", JSON.stringify({ timestamp: Date.now() }));

                const pushAllSnapshots = async () => {
                  try {
                    const rows = await fetchServiceRows(database, params.id);
                    const resourcesByPid = includeResources
                      ? await sampleServiceResources(deps, rows)
                      : new Map<number, ProcessResourceSnapshot>();
                    for (const row of rows) {
                      const payload = await serializeService(
                        deps,
                        database,
                        row,
                        {
                          includeResources,
                          resourcesByPid,
                        }
                      );
                      sendEvent("service", JSON.stringify(payload));
                    }
                    sendEvent(
                      "snapshot",
                      JSON.stringify({ timestamp: Date.now() })
                    );
                  } catch (error) {
                    log.error({ error }, "Failed to stream service snapshot");
                  }
                };

                let pushAllSnapshotsInFlight: Promise<void> | null = null;
                const pushAllSnapshotsWithGuard = () => {
                  if (pushAllSnapshotsInFlight) {
                    return;
                  }

                  pushAllSnapshotsInFlight = pushAllSnapshots().finally(() => {
                    pushAllSnapshotsInFlight = null;
                  });
                };

                pushAllSnapshotsWithGuard();

                const resourcesInterval = includeResources
                  ? setInterval(() => {
                      pushAllSnapshotsWithGuard();
                    }, SERVICES_RESOURCE_REFRESH_INTERVAL_MS)
                  : null;

                cleanup = () => {
                  unsubscribe();
                  clearInterval(heartbeat);
                  if (resourcesInterval) {
                    clearInterval(resourcesInterval);
                  }
                };
              },
              cancel() {
                cleanup?.();
              },
            });

            return new Response(body, {
              headers: {
                "Cache-Control": "no-cache",
                "Content-Type": "text/event-stream",
                Connection: "keep-alive",
              },
            });
          },
        });
      },
      {
        params: CellIdParamsSchema,
        query: t.Object({
          includeResources: t.Optional(t.Boolean()),
        }),
      }
    )

    .get(
      "/:id/setup/terminal/stream",
      async ({ params, set, request }) =>
        await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: (cell, deps) => {
            const session = deps.getSetupTerminalSession(cell.id);
            const setupState = deriveSetupTerminalState(cell, session);
            const initialOutput = deps.readSetupTerminalOutput(cell.id);
            const { iterator, cleanup } =
              createAsyncEventIterator<ServiceTerminalEvent>(
                (listener) => deps.subscribeToSetupTerminal(cell.id, listener),
                request.signal
              );

            return createTerminalEventStream({
              readyData: {
                session,
                setupState,
                lastSetupError: cell.lastSetupError,
              },
              initialOutput,
              iterator,
              cleanup,
              sessionReadyData: wrappedTerminalSessionReadyData,
            });
          },
        }),
      {
        params: CellIdParamsSchema,
        response: {
          200: t.Any(),
          404: MessageResponseSchema,
        },
      }
    )

    .ws("/:id/setup/terminal/ws", {
      params: CellIdParamsSchema,
      body: t.Any(),
      async open(ws) {
        await openSetupTerminalSocket(ws);
      },
      async message(ws, rawMessage) {
        await handleSetupTerminalSocketMessage(ws, rawMessage);
      },
      close(ws) {
        runWsCleanup(ws.id);
      },
    })

    .post(
      "/:id/setup/terminal/resize",
      async ({ params, body, set, log }) =>
        await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: (cell, deps) =>
            runTerminalResizeAction({
              set,
              log,
              logContext: { cellId: cell.id },
              unavailableMessage: "Setup terminal session not available",
              errorMessage: "Failed to resize setup terminal session",
              resize: () =>
                deps.resizeSetupTerminal(cell.id, body.cols, body.rows),
              getSession: () => deps.getSetupTerminalSession(cell.id),
            }),
        }),
      {
        ...RuntimeTerminalResizeRouteOptions,
      }
    )

    .post(
      "/:id/setup/terminal/input",
      async function writeSetupTerminalRoute({ params, body, set, log }) {
        return await withResolvedCellRoute({
          run: (cell, deps) =>
            runTerminalInputAction({
              getSession: () => deps.getSetupTerminalSession(cell.id),
              write: () => deps.writeSetupTerminalInput(cell.id, body.data),
              unavailableMessage: "Setup terminal session not available",
              errorMessage: "Failed to write to setup terminal session",
              logContext: { cellId: cell.id },
              set,
              log,
            }),
          cellId: params.id,
          set,
        });
      },
      {
        ...RuntimeTerminalInputRouteOptions,
      }
    )

    .get(
      "/:id/services/:serviceId/terminal/stream",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies { message: string };
        }

        const session = deps.getServiceTerminalSession(row.service.id);
        const initialOutput = deps.readServiceTerminalOutput(row.service.id);
        const { iterator, cleanup } =
          createAsyncEventIterator<ServiceTerminalEvent>(
            (listener) =>
              deps.subscribeToServiceTerminal(row.service.id, listener),
            request.signal
          );

        return createTerminalEventStream({
          readyData: { session },
          initialOutput,
          iterator,
          cleanup,
          sessionReadyData: wrappedTerminalSessionReadyData,
        });
      },
      {
        params: CellServiceParamsSchema,
        response: {
          200: t.Any(),
          404: MessageResponseSchema,
        },
      }
    )

    .ws("/:id/services/:serviceId/terminal/ws", {
      params: CellServiceParamsSchema,
      body: t.Any(),
      async open(ws) {
        await openServiceTerminalSocket(ws);
      },
      async message(ws, rawMessage) {
        await handleServiceTerminalSocketMessage(ws, rawMessage);
      },
      close(ws) {
        runWsCleanup(ws.id);
      },
    })

    .post(
      "/:id/services/:serviceId/terminal/input",
      async ({ params, body, set, log }) =>
        await withResolvedServiceRoute({
          cellId: params.id,
          serviceId: params.serviceId,
          set,
          run: (row, deps) =>
            runTerminalInputAction({
              set,
              log,
              logContext: { serviceId: row.service.id },
              unavailableMessage: "Service terminal session not available",
              errorMessage: "Failed to write to service terminal session",
              getSession: () => deps.getServiceTerminalSession(row.service.id),
              write: () =>
                deps.writeServiceTerminalInput(row.service.id, body.data),
            }),
        }),
      {
        ...ServiceTerminalInputRouteOptions,
      }
    )

    .post(
      "/:id/services/:serviceId/terminal/resize",
      async function resizeServiceTerminalRoute({ params, body, set, log }) {
        return await withResolvedServiceRoute({
          run: (row, deps) =>
            runTerminalResizeAction({
              resize: () =>
                deps.resizeServiceTerminal(
                  row.service.id,
                  body.cols,
                  body.rows
                ),
              getSession: () => deps.getServiceTerminalSession(row.service.id),
              logContext: { serviceId: row.service.id },
              unavailableMessage: "Service terminal session not available",
              errorMessage: "Failed to resize service terminal session",
              set,
              log,
            }),
          cellId: params.id,
          serviceId: params.serviceId,
          set,
        });
      },
      {
        ...ServiceTerminalResizeRouteOptions,
      }
    )

    .get(
      "/:id/chat/terminal/stream",
      async ({ params, query, set, request, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        let session: ChatTerminalSession;
        let chatTerminal: ChatTerminalDependencies;
        const themeMode = normalizeOpencodeThemeMode(query.themeMode);
        try {
          if (!isCellReadyForChat(cell)) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message:
                "Chat terminal is unavailable until provisioning completes",
            } satisfies { message: string };
          }

          const prepared = await ensureChatTerminalSessionForCell(
            deps,
            cell,
            themeMode
          );
          session = prepared.session;
          chatTerminal = prepared.chatTerminal;
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to initialize chat terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to initialize chat terminal session",
          } satisfies { message: string };
        }

        const initialOutput = chatTerminal.readChatTerminalOutput(cell.id);
        const { iterator, cleanup } =
          createAsyncEventIterator<ChatTerminalEvent>(
            (listener) =>
              chatTerminal.subscribeToChatTerminal(cell.id, listener),
            request.signal
          );

        return createTerminalEventStream({
          readyData: session,
          initialOutput,
          iterator,
          cleanup,
        });
      },
      {
        params: CellIdParamsSchema,
        query: ChatThemeModeQuerySchema,
        response: {
          200: t.Any(),
          ...TerminalErrorResponses,
        },
      }
    )

    .ws("/:id/chat/terminal/ws", {
      params: CellIdParamsSchema,
      query: ChatThemeModeQuerySchema,
      body: t.Any(),
      async open(ws) {
        const deps = await resolveDeps();
        const cell = await loadCellForWs(deps, ws);
        if (!cell) {
          return;
        }

        if (!isCellReadyForChat(cell)) {
          sendWsErrorAndClose(
            ws,
            "Chat terminal is unavailable until provisioning completes"
          );
          return;
        }

        const themeMode = normalizeOpencodeThemeMode(ws.data.query?.themeMode);
        let prepared: Awaited<
          ReturnType<typeof ensureChatTerminalSessionForCell>
        >;
        try {
          prepared = await ensureChatTerminalSessionForCell(
            deps,
            cell,
            themeMode
          );
        } catch (error) {
          sendWsErrorAndClose(
            ws,
            error instanceof Error
              ? error.message
              : "Failed to initialize chat terminal"
          );
          return;
        }

        const initialOutput = prepared.chatTerminal.readChatTerminalOutput(
          cell.id
        );
        const unsubscribe = prepared.chatTerminal.subscribeToChatTerminal(
          cell.id,
          (event) => {
            forwardTerminalEventToWs(ws, event);
          }
        );

        openTerminalWs({
          ws,
          unsubscribe,
          state: {
            kind: "chat",
            deps,
            cell,
            themeMode,
            chatTerminal: prepared.chatTerminal,
          },
          readyPayload: { session: prepared.session },
          initialOutput,
        });
      },
      async message(ws, rawMessage) {
        await handleTerminalWsControlMessage(ws, rawMessage, "chat", {
          input: (state, data) =>
            state.chatTerminal.writeChatTerminalInput(state.cell.id, data),
          resize: (state, cols, rows) => {
            state.chatTerminal.resizeChatTerminal(state.cell.id, cols, rows);
            const resizedSession = state.chatTerminal.getChatTerminalSession(
              state.cell.id
            );
            if (!resizedSession) {
              sendWsError(ws, "Chat terminal session not available");
              return;
            }
            ws.send({ type: "ready", session: resizedSession });
          },
          restart: (state) => restartChatTerminalSocket(ws, state),
        });
      },
      close(ws) {
        runWsCleanup(ws.id);
      },
    })

    .post(
      "/:id/chat/terminal/input",
      async ({ params, query, body, set, log }) =>
        await withResolvedChatTerminalRoute({
          cellId: params.id,
          themeMode: normalizeOpencodeThemeMode(query.themeMode),
          set,
          log,
          errorMessage: "Failed to write to chat terminal session",
          run: (cell, { chatTerminal }) => {
            chatTerminal.writeChatTerminalInput(cell.id, body.data);
            return { ok: true };
          },
        }),
      {
        params: CellIdParamsSchema,
        query: ChatThemeModeQuerySchema,
        body: CellTerminalInputSchema,
        response: {
          200: CellTerminalActionResponseSchema,
          ...TerminalErrorResponses,
        },
      }
    )

    .post(
      "/:id/chat/terminal/resize",
      async function resizeChatTerminalRoute({
        params,
        query,
        body,
        set,
        log,
      }) {
        return await withResolvedChatTerminalRoute({
          run: (cell, { session, chatTerminal }) => {
            chatTerminal.resizeChatTerminal(cell.id, body.cols, body.rows);
            return buildTerminalResizeResponse(session, body.cols, body.rows);
          },
          errorMessage: "Failed to resize chat terminal session",
          themeMode: normalizeOpencodeThemeMode(query.themeMode),
          cellId: params.id,
          set,
          log,
        });
      },
      {
        params: CellIdParamsSchema,
        query: ChatThemeModeQuerySchema,
        body: CellTerminalResizeSchema,
        response: {
          200: RuntimeTerminalResizeOkResponseSchema,
          ...TerminalErrorResponses,
        },
      }
    )

    .post(
      "/:id/chat/terminal/restart",
      async function restartChatTerminalRoute({ params, query, set, log }) {
        const requestedThemeMode = normalizeOpencodeThemeMode(query.themeMode);
        return await withResolvedChatTerminalRoute({
          run: async (cell, _prepared, deps) => {
            const chatTerminal = getChatTerminalDependencies(deps);
            chatTerminal.closeChatTerminalSession(cell.id);
            const { session } = await ensureChatTerminalSessionForCell(
              deps,
              cell,
              requestedThemeMode
            );
            return session;
          },
          cellId: params.id,
          themeMode: requestedThemeMode,
          errorMessage: "Failed to restart chat terminal session",
          set,
          log,
        });
      },
      {
        params: CellIdParamsSchema,
        query: ChatThemeModeQuerySchema,
        response: {
          200: CellTerminalSessionSchema,
          ...TerminalErrorResponses,
        },
      }
    )

    .get(
      "/:id/terminal/stream",
      async ({ params, set, request, log }) =>
        await withResolvedCellTerminalRoute({
          cellId: params.id,
          set,
          log,
          errorMessage: "Failed to initialize terminal session",
          run: async (cell, deps) => {
            const session = await ensureCellTerminalSessionForCell(deps, cell);

            const initialOutput = deps.readTerminalOutput(cell.id);
            const { iterator, cleanup } =
              createAsyncEventIterator<CellTerminalEvent>(
                (listener) => deps.subscribeToTerminal(cell.id, listener),
                request.signal
              );

            return createSessionTerminalEventStream({
              session,
              cleanup,
              initialOutput,
              iterator,
            });
          },
        }),
      {
        params: CellIdParamsSchema,
        response: {
          200: t.Any(),
          ...CellTerminalStreamErrorResponses,
        },
      }
    )

    .ws("/:id/terminal/ws", {
      params: CellIdParamsSchema,
      body: t.Any(),
      async open(ws) {
        await openCellTerminalSocket(ws);
      },
      async message(ws, rawMessage) {
        await handleTerminalWsControlMessage(ws, rawMessage, "cell", {
          input: (state, data) =>
            handleCellTerminalWsInput({
              deps: state.deps,
              cellId: state.cell.id,
              data,
            }),
          resize: (state, cols, rows) =>
            handleCellTerminalWsResize({
              deps: state.deps,
              ws,
              cell: state.cell,
              cols,
              rows,
            }),
          restart: (state) => restartCellTerminalSocket(ws, state),
        });
      },
      close(ws) {
        runWsCleanup(ws.id);
      },
    })

    .post(
      "/:id/terminal/input",
      async ({ params, body, set, log }) =>
        await withResolvedCellTerminalRoute({
          cellId: params.id,
          set,
          log,
          errorMessage: "Failed to write to terminal session",
          run: async (cell, deps) => {
            await ensureCellTerminalSessionForCell(deps, cell);
            deps.writeTerminalInput(cell.id, body.data);
            return { ok: true };
          },
        }),
      {
        ...CellTerminalInputRouteOptions,
      }
    )

    .post(
      "/:id/terminal/resize",
      async function resizeCellTerminalRoute({ params, body, set, log }) {
        return await withResolvedCellTerminalRoute({
          run: async (cell, deps) => {
            const session = await ensureCellTerminalSessionForCell(deps, cell);
            deps.resizeTerminal(cell.id, body.cols, body.rows);
            return buildTerminalResizeResponse(session, body.cols, body.rows);
          },
          cellId: params.id,
          errorMessage: "Failed to resize terminal session",
          set,
          log,
        });
      },
      {
        ...CellTerminalResizeRouteOptions,
      }
    )

    .post(
      "/:id/terminal/restart",
      async ({ params, set, log }) =>
        await withResolvedCellTerminalRoute({
          cellId: params.id,
          set,
          log,
          errorMessage: "Failed to restart terminal session",
          run: async (cell, deps) => {
            deps.closeTerminalSession(cell.id);
            return await ensureCellTerminalSessionForCell(deps, cell);
          },
        }),
      {
        params: CellIdParamsSchema,
        response: {
          200: CellTerminalSessionSchema,
          404: MessageResponseSchema,
          500: MessageResponseSchema,
        },
      }
    )

    .post(
      "/:id/services/start",
      async (context) => {
        context.server?.timeout(context.request, 0);
        return await handleBulkServiceRoute(context, {
          type: "services.start",
          run: (deps) => deps.startServicesForCell(context.params.id),
          queueAction: true,
        });
      },
      {
        ...ServiceListRouteOptions,
      }
    )

    .post(
      "/:id/services/stop",
      async (context) => {
        context.server?.timeout(context.request, 0);
        return await handleBulkServiceRoute(context, {
          type: "services.stop",
          run: (deps) => deps.stopServicesForCell(context.params.id),
          queueAction: true,
        });
      },
      {
        ...ServiceListRouteOptions,
      }
    )

    .get(
      "/:id/diff",
      async ({ params, query, set }) =>
        await withResolvedCellRoute({
          cellId: params.id,
          set,
          run: async (cell) => {
            const parsed = parseDiffRequest(cell, query);
            if (!parsed.ok) {
              set.status = parsed.status;
              return { message: parsed.message } satisfies { message: string };
            }

            try {
              const diff = await buildCellDiffPayload(cell, parsed.value);
              return diff satisfies CellDiffResponse;
            } catch (error) {
              set.status = HTTP_STATUS.INTERNAL_ERROR;
              return {
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to compute diff",
              } satisfies { message: string };
            }
          },
        }),
      {
        params: CellIdParamsSchema,
        query: DiffQuerySchema,
        response: {
          200: CellDiffResponseSchema,
          400: MessageResponseSchema,
          409: MessageResponseSchema,
          404: MessageResponseSchema,
        },
      }
    )

    .post(
      "/:id/services/:serviceId/start",

      async ({ params, set, request, server, log }) =>
        await runResolvedSingleServiceAction({
          cellId: params.id,
          serviceId: params.serviceId,
          set,
          log,
          request,
          server,
          type: "service.start",
          action: (deps, serviceId) => deps.startServiceById(serviceId),
          queueAction: true,
        }),
      {
        ...ServiceActionRouteOptions,
      }
    )
    .post(
      "/:id/services/:serviceId/stop",
      async function stopSingleServiceRoute({
        params,
        set,
        request,
        server,
        log,
      }) {
        return await runResolvedSingleServiceAction({
          action: (deps, serviceId) => deps.stopServiceById(serviceId),
          type: "service.stop",
          request,
          server,
          set,
          log,
          queueAction: true,
          serviceId: params.serviceId,
          cellId: params.id,
        });
      },
      {
        ...ServiceActionRouteOptions,
      }
    )

    .post(
      "/:id/services/restart",
      async (context) => {
        context.server?.timeout(context.request, 0);
        return await handleBulkServiceRoute(context, {
          type: "services.restart",
          run: async (deps) => {
            await deps.stopServicesForCell(context.params.id);
            await deps.startServicesForCell(context.params.id);
          },
          queueAction: true,
        });
      },
      {
        ...ServiceListRouteOptions,
      }
    )

    .post(
      "/:id/services/:serviceId/restart",
      async function restartSingleServiceRoute({
        params,
        set,
        request,
        server,
        log,
      }) {
        return await runResolvedSingleServiceAction({
          action: async (deps, serviceId) => {
            await deps.stopServiceById(serviceId);
            await deps.startServiceById(serviceId);
          },
          metadata: (row) => ({ serviceName: row.service.name }),
          type: "service.restart",
          request,
          server,
          serviceId: params.serviceId,
          cellId: params.id,
          set,
          log,
          queueAction: true,
        });
      },
      {
        ...ServiceActionRouteOptions,
      }
    )
    .post(
      "/",
      async ({ body, set, log, getWorkspaceContext }) => {
        try {
          const deps = await resolveDeps();
          const {
            db: database,
            ensureAgentSession: ensureSession,
            sendAgentMessage: sendMessage,
            ensureServicesForCell: ensureServices,
            stopServicesForCell: stopCellServicesFn,
            runCellTeardown,
          } = deps;

          const workspaceContext = await getWorkspaceContext(body.workspaceId);
          const result = await handleCellCreationRequest({
            body,
            database,
            ensureSession,
            sendAgentMessage: sendMessage,
            ensureServices,
            stopCellServices: stopCellServicesFn,
            runCellTeardown,
            workspaceContext,
            log,
          });

          set.status = result.status;
          return result.payload;
        } catch (error) {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return {
            message:
              error instanceof Error ? error.message : "Failed to create cell",
          };
        }
      },
      {
        body: CreateCellSchema,
        response: {
          201: CellResponseSchema,
          400: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
        },
      }
    )
    .delete(
      "/",
      async ({ body, set, log, request, server }) => {
        server?.timeout(request, 0);
        try {
          const deletionRuntime = await resolveDeletionRuntime();
          const { resolveWorkspace, deletionDependencies } = deletionRuntime;

          const uniqueIds = [...new Set(body.ids)];

          const cellsToDelete = await deletionDependencies.database
            .select()
            .from(cells)
            .where(inArray(cells.id, uniqueIds));

          if (cellsToDelete.length === 0) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "No cells found for provided ids" };
          }

          const deletedIds: string[] = [];

          for (const cell of cellsToDelete) {
            try {
              const getWorktreeService = createDeletionWorktreeServiceGetter(
                resolveWorkspace,
                cell
              );
              await deleteCellWithLifecycle({
                ...deletionDependencies,
                cell,
                getWorktreeService,
                log,
              });
              deletedIds.push(cell.id);
            } catch (error) {
              log.error(
                {
                  error,
                  cellId: cell.id,
                },
                "Failed to delete cell during bulk delete"
              );
            }
          }

          if (deletedIds.length === 0) {
            set.status = HTTP_STATUS.INTERNAL_ERROR;
            return { message: "Failed to delete cells" };
          }

          return { deletedIds };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete cells");
          } else {
            log.error({ error }, "Failed to delete cells");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete cells" };
        }
      },
      {
        body: DeleteCellsSchema,
        response: {
          200: t.Object({
            deletedIds: t.Array(t.String()),
          }),
          400: MessageResponseSchema,
          ...DeleteCellErrorResponses,
        },
      }
    )
    .delete(
      "/:id",
      async ({ params, set, log, request, server }) => {
        server?.timeout(request, 0);
        try {
          const { resolveWorkspace, deletionDependencies } =
            await resolveDeletionRuntime();

          const cell = await loadCellById(
            deletionDependencies.database,
            params.id
          );
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          const getWorktreeService = createDeletionWorktreeServiceGetter(
            resolveWorkspace,
            cell
          );
          await deleteCellWithLifecycle({
            ...deletionDependencies,
            getWorktreeService,
            log,
            cell,
          });

          return { message: "Cell deleted successfully" };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete cell");
          } else {
            log.error({ error }, "Failed to delete cell");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return {
            message:
              error instanceof Error
                ? `Failed to delete cell: ${error.message}`
                : "Failed to delete cell",
          };
        }
      },
      {
        params: CellIdParamsSchema,
        response: {
          200: t.Object({
            message: t.String(),
          }),
          ...DeleteCellErrorResponses,
        },
      }
    );
}

export const cellsRoutes = createCellsRoutes();

type CellCreationResult = {
  status: number;
  payload: CellCreationPayload;
};

type CellCreationPayload = ReturnType<typeof cellToResponse> | ErrorPayload;

type ProvisionRuntimeDeps = {
  database: DatabaseClient;
  ensureSession: CellRouteDependencies["ensureAgentSession"];
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  ensureServices: CellRouteDependencies["ensureServicesForCell"];
  stopCellServices: CellRouteDependencies["stopServicesForCell"];
  runCellTeardown: CellRouteDependencies["runCellTeardown"];
  log: LoggerLike;
};

type CellCreationArgs = ProvisionRuntimeDeps & {
  body: Static<typeof CreateCellSchema>;
  workspaceContext: WorkspaceRuntimeContext;
};

async function handleCellCreationRequest(
  args: CellCreationArgs
): Promise<CellCreationResult> {
  const {
    body: rawBody,
    database,
    ensureSession,
    sendAgentMessage: dispatchAgentMessage,
    ensureServices,
    stopCellServices,
    runCellTeardown,
    workspaceContext,
    log,
  } = args;

  const hiveConfig = await workspaceContext.loadConfig();
  const defaultStartMode = await resolveDefaultStartMode({
    workspaceRootPath: workspaceContext.workspace.path,
    defaultsStartMode: hiveConfig.defaults?.startMode,
    configDefaultMode: hiveConfig.opencode?.defaultMode,
  });
  const worktreeStartPoint = resolveWorktreeStartPoint(rawBody);
  const body: CreateCellRequest = {
    ...rawBody,
    initialPromptImages: sanitizeInitialPromptImages(
      rawBody.initialPromptImages
    ),
    startMode: normalizeStartMode(rawBody.startMode) ?? defaultStartMode,
    spawnFromMode: worktreeStartPoint.mode,
    spawnFromValue:
      "value" in worktreeStartPoint ? worktreeStartPoint.value : undefined,
  };

  const template = hiveConfig.templates[body.templateId];
  if (!template) {
    return {
      status: HTTP_STATUS.BAD_REQUEST,
      payload: { message: "Template not found" },
    };
  }

  const worktreeService = toAsyncWorktreeManager(
    await workspaceContext.createWorktreeManager()
  );
  const context = createProvisionContext({
    body,
    template,
    database,
    ensureSession,
    sendAgentMessage: dispatchAgentMessage,
    ensureServices,
    stopCellServices,
    runCellTeardown,
    getWorktreeService: async () => worktreeService,
    workspace: workspaceContext.workspace,
    log,
  });

  const createRequestStartedAt = new Date();
  await insertCellTimingEvent({
    database,
    log,
    cellId: context.state.cellId,
    cellName: body.name,
    workflow: "create",
    runId: context.state.timingRunId,
    step: "create_request_received",
    status: "ok",
    durationMs: 0,
    templateId: body.templateId,
    workspaceId: workspaceContext.workspace.id,
    createdAt: createRequestStartedAt,
  });

  try {
    const createRecord = await createCellRecord(context);
    const { cell, timing } = createRecord;
    const createRecordDurationMs = timing.totalDurationMs;
    context.log.info?.(
      {
        cellId: context.state.cellId,
        templateId: body.templateId,
        workspaceId: workspaceContext.workspace.id,
        phase: "create_cell_record",
        durationMs: createRecordDurationMs,
      },
      "Cell creation phase completed"
    );

    const creationSteps: Array<{
      step: string;
      durationMs: number;
      createdAt: Date;
      metadata?: Record<string, unknown>;
    }> = [
      {
        step: "insert_cell_record",
        durationMs: timing.insertCellRecordDurationMs,
        createdAt: timing.insertCellRecordCompletedAt,
      },
      {
        step: "insert_provisioning_state",
        durationMs: timing.insertProvisioningStateDurationMs,
        createdAt: timing.insertProvisioningStateCompletedAt,
      },
      {
        step: "create_cell_record",
        durationMs: createRecordDurationMs,
        createdAt: timing.totalCompletedAt,
        metadata: {
          phaseDurations: {
            insert_cell_record: timing.insertCellRecordDurationMs,
            insert_provisioning_state: timing.insertProvisioningStateDurationMs,
          },
        },
      },
    ];

    for (const step of creationSteps) {
      await insertCellTimingEvent({
        database,
        log,
        cellId: context.state.cellId,
        cellName: body.name,
        workflow: "create",
        runId: context.state.timingRunId,
        step: step.step,
        status: "ok",
        durationMs: step.durationMs,
        templateId: body.templateId,
        workspaceId: workspaceContext.workspace.id,
        extraMetadata: step.metadata,
        createdAt: step.createdAt,
      });
    }

    startProvisioningWorkflow(context);
    return {
      status: HTTP_STATUS.CREATED,
      payload: cellToResponse(cell),
    };
  } catch (error) {
    return recoverCellCreationFailure(context, error);
  }
}

type ProvisionContext = ProvisionRuntimeDeps & {
  body: Static<typeof CreateCellSchema>;
  template: Template;
  getWorktreeService: () => Promise<AsyncWorktreeManager>;
  workspace: WorkspaceRecord;
  state: CellProvisionState;
};

type CellProvisionState = {
  cellId: string;
  worktreeCreated: boolean;
  recordCreated: boolean;
  servicesStarted: boolean;
  timingRunId: string;
  provisioningStartedAtMs: number | null;
  workspacePath: string | null;
  branchName: string | null;
  baseCommit: string | null;
  createdCell: typeof cells.$inferSelect | null;
  provisioningState: CellProvisioningState | null;
};

type CellCreationRecordTiming = {
  insertCellRecordDurationMs: number;
  insertCellRecordCompletedAt: Date;
  insertProvisioningStateDurationMs: number;
  insertProvisioningStateCompletedAt: Date;
  totalDurationMs: number;
  totalCompletedAt: Date;
};

type CellCreationRecordResult = {
  cell: typeof cells.$inferSelect;
  timing: CellCreationRecordTiming;
};

type CapturedWorktreeCreateTimingEvent = WorktreeCreateTimingEvent & {
  capturedAt: Date;
};

type ProvisionPhase =
  | "create_worktree"
  | "ensure_services"
  | "ensure_agent_session"
  | "send_initial_prompt"
  | "mark_ready";

type RunProvisionPhase = <T>(
  phase: ProvisionPhase,
  action: () => Promise<T>
) => Promise<T>;

type ProvisionTimingEventInput = {
  step: string;
  status: CellTimingStatus;
  durationMs: number;
  attempt: number | null;
  error?: string | null;
  extraMetadata?: Record<string, unknown>;
  createdAt?: Date;
};

async function insertProvisionTimingEvent(
  context: ProvisionContext,
  event: ProvisionTimingEventInput
) {
  await insertCellTimingEvent({
    database: context.database,
    log: context.log,
    cellId: context.state.cellId,
    cellName: context.state.createdCell?.name ?? context.body.name,
    workflow: "create",
    runId: context.state.timingRunId,
    step: event.step,
    status: event.status,
    durationMs: event.durationMs,
    attempt: event.attempt,
    error: event.error,
    templateId: context.template.id,
    workspaceId: context.workspace.id,
    extraMetadata: event.extraMetadata,
    createdAt: event.createdAt,
  });
}

function createProvisionContext(
  args: ProvisionRuntimeDeps & {
    body: Static<typeof CreateCellSchema>;
    template: Template;
    getWorktreeService: () => Promise<AsyncWorktreeManager>;
    workspace: WorkspaceRecord;
  }
): ProvisionContext {
  return {
    ...args,
    state: {
      cellId: randomUUID(),
      worktreeCreated: false,
      recordCreated: false,
      servicesStarted: false,
      timingRunId: randomUUID(),
      provisioningStartedAtMs: null,
      workspacePath: null,
      branchName: null,
      baseCommit: null,
      createdCell: null,
      provisioningState: null,
    },
  };
}

function createExistingProvisionContext(
  args: {
    cell: typeof cells.$inferSelect;
    provisioningState: CellProvisioningState | null;
    body: Static<typeof CreateCellSchema>;
    template: Template;
    workspaceContext: WorkspaceRuntimeContext;
  } & ProvisionRuntimeDeps
): ProvisionContext {
  return {
    body: args.body,
    template: args.template,
    database: args.database,
    ensureSession: args.ensureSession,
    sendAgentMessage: args.sendAgentMessage,
    ensureServices: args.ensureServices,
    stopCellServices: args.stopCellServices,
    runCellTeardown: args.runCellTeardown,
    getWorktreeService: async () =>
      toAsyncWorktreeManager(
        await args.workspaceContext.createWorktreeManager()
      ),
    workspace: args.workspaceContext.workspace,
    log: args.log,
    state: {
      cellId: args.cell.id,
      worktreeCreated: Boolean(args.cell.baseCommit && args.cell.workspacePath),
      recordCreated: true,
      servicesStarted: false,
      timingRunId: randomUUID(),
      provisioningStartedAtMs: null,
      workspacePath: args.cell.workspacePath,
      branchName: args.cell.branchName,
      baseCommit: args.cell.baseCommit,
      createdCell: args.cell,
      provisioningState: args.provisioningState,
    },
  };
}

async function createCellRecord(
  context: ProvisionContext
): Promise<CellCreationRecordResult> {
  const { body, database, workspace, state } = context;

  const createRecordStartedAt = Date.now();
  let insertCellRecordDurationMs = 0;
  let insertCellRecordCompletedAt = new Date(createRecordStartedAt);
  let insertProvisioningStateDurationMs = 0;
  let insertProvisioningStateCompletedAt = new Date(createRecordStartedAt);

  const expectedWorkspacePath = join(resolveCellsRoot(), state.cellId);
  const branchName = `cell-${state.cellId}`;

  state.workspacePath = expectedWorkspacePath;
  state.branchName = branchName;
  state.baseCommit = null;

  const timestamp = new Date();
  const newCell: NewCell = {
    id: state.cellId,
    name: body.name,
    description: body.description ?? null,
    templateId: body.templateId,
    workspacePath: expectedWorkspacePath,
    workspaceId: workspace.id,
    workspaceRootPath: workspace.path,
    branchName,
    baseCommit: null,
    opencodeSessionId: null,
    createdAt: timestamp,
    status: "spawning",
    lastSetupError: null,
  };

  const insertCellStartedAt = Date.now();
  const [created] = await database.insert(cells).values(newCell).returning();
  insertCellRecordDurationMs = Date.now() - insertCellStartedAt;
  insertCellRecordCompletedAt = new Date();

  if (!created) {
    throw new Error("Failed to create cell record");
  }

  state.recordCreated = true;
  state.createdCell = created;

  const insertProvisioningStartedAt = Date.now();
  const [provisioningState] = await database
    .insert(cellProvisioningStates)
    .values({
      cellId: state.cellId,
      modelIdOverride: body.modelId ?? null,
      providerIdOverride: body.providerId ?? null,
      variantOverride: body.variant ?? null,
      startMode: body.startMode ?? "plan",
      initialPromptImagesJson: serializeInitialPromptImages(
        body.initialPromptImages
      ),
      startedAt: null,
      finishedAt: null,
      attemptCount: 0,
    })
    .returning();
  insertProvisioningStateDurationMs = Date.now() - insertProvisioningStartedAt;
  insertProvisioningStateCompletedAt = new Date();

  state.provisioningState = provisioningState ?? null;

  const totalCompletedAt = new Date();
  return {
    cell: created,
    timing: {
      insertCellRecordDurationMs,
      insertCellRecordCompletedAt,
      insertProvisioningStateDurationMs,
      insertProvisioningStateCompletedAt,
      totalDurationMs: totalCompletedAt.getTime() - createRecordStartedAt,
      totalCompletedAt,
    },
  };
}

async function ensureCellWorktree(
  context: ProvisionContext,
  onTimingEvent?: (event: CapturedWorktreeCreateTimingEvent) => void
): Promise<void> {
  const { body, database, state } = context;
  await runWithCellCleanupLock(state.cellId, async () => {
    await assertCellStillExists(context, "create_worktree");
    if (state.worktreeCreated && state.workspacePath && state.baseCommit) {
      return;
    }

    const worktreeService = await context.getWorktreeService();
    let worktree: { path: string; branch: string; baseCommit: string };
    try {
      worktree = await worktreeService.createWorktree(state.cellId, {
        templateId: body.templateId,
        force: true,
        startPoint: resolveWorktreeStartPoint(body),
        onTimingEvent: (event) => {
          onTimingEvent?.({
            ...event,
            capturedAt: new Date(),
          });
        },
      });
    } catch (error) {
      const details =
        error && typeof error === "object" && "kind" in error
          ? describeWorktreeError(error as WorktreeManagerError)
          : error;
      context.log.error(
        {
          error: details,
          cellId: state.cellId,
        },
        "Failed to create git worktree"
      );
      throw error;
    }

    state.worktreeCreated = true;
    state.workspacePath = worktree.path;
    state.branchName = worktree.branch;
    state.baseCommit = worktree.baseCommit;

    await database
      .update(cells)
      .set({
        workspacePath: worktree.path,
        branchName: worktree.branch,
        baseCommit: worktree.baseCommit,
      })
      .where(eq(cells.id, state.cellId));

    if (state.createdCell) {
      state.createdCell = {
        ...state.createdCell,
        workspacePath: worktree.path,
        branchName: worktree.branch,
        baseCommit: worktree.baseCommit,
      };
    }
  });
}

function startProvisioningWorkflow(context: ProvisionContext) {
  const cellId = context.state.cellId;
  if (activeProvisioningWorkflows.has(cellId)) {
    context.log.info?.(
      { cellId },
      "Skipped provisioning workflow start because another attempt is active"
    );
    return false;
  }

  activeProvisioningWorkflows.add(cellId);
  beginProvisioningAttempt(context)
    .then(() => finalizeCellProvisioning(context))
    .catch((error) => {
      handleDeferredProvisionFailure(context, error).catch((cleanupError) => {
        context.log.error(
          cleanupError instanceof Error
            ? cleanupError
            : { error: cleanupError },
          "Failed to handle provisioning failure"
        );
      });
    })
    .finally(() => {
      activeProvisioningWorkflows.delete(cellId);
    });

  return true;
}

async function beginProvisioningAttempt(
  context: ProvisionContext
): Promise<void> {
  if (!context.state.provisioningState) {
    throw new Error("Provisioning metadata missing for cell");
  }

  const startedAt = new Date();
  await context.database
    .update(cellProvisioningStates)
    .set({
      startedAt,
      finishedAt: null,
      attemptCount: sql`${cellProvisioningStates.attemptCount} + 1`,
    })
    .where(eq(cellProvisioningStates.cellId, context.state.cellId));

  context.state.provisioningState = {
    ...context.state.provisioningState,
    startedAt,
    finishedAt: null,
    attemptCount: context.state.provisioningState.attemptCount + 1,
  };
}

async function runCreateWorktreePhase(args: {
  context: ProvisionContext;
  runPhase: RunProvisionPhase;
  attempt: number | null;
}) {
  const { context, runPhase, attempt } = args;
  const { state } = context;

  await assertCellStillExists(context, "create_worktree");

  if (state.worktreeCreated && state.workspacePath && state.baseCommit) {
    return;
  }

  const worktreeTimingWrites: Promise<void>[] = [];

  const persistWorktreeTimingEvent = (
    event: CapturedWorktreeCreateTimingEvent
  ) => {
    worktreeTimingWrites.push(
      insertProvisionTimingEvent(context, {
        step: `create_worktree:${event.step}`,
        status: "ok",
        durationMs: event.durationMs,
        attempt,
        extraMetadata: event.metadata,
        createdAt: event.capturedAt,
      })
    );
  };

  try {
    await runPhase("create_worktree", async () => {
      await ensureCellWorktree(context, persistWorktreeTimingEvent);
    });
  } finally {
    await settleProvisionTimingWrites({
      context,
      writes: worktreeTimingWrites,
      phase: "create_worktree",
    });
  }
}

async function settleProvisionTimingWrites(args: {
  context: ProvisionContext;
  writes: Promise<void>[];
  phase: "create_worktree" | "ensure_services";
}) {
  const settledWrites = await Promise.allSettled(args.writes);
  for (const write of settledWrites) {
    if (write.status === "rejected") {
      args.context.log.warn(
        { error: write.reason, cellId: args.context.state.cellId },
        `Failed to persist ${args.phase} timing sub-step`
      );
    }
  }
}

async function finalizeCellProvisioning(
  context: ProvisionContext
): Promise<void> {
  const {
    body,
    template,
    ensureSession,
    sendAgentMessage: dispatchAgentMessage,
    ensureServices,
    database,
    state,
  } = context;

  if (!state.createdCell) {
    throw new Error("Cell record missing during provisioning");
  }

  const attempt = state.provisioningState?.attemptCount ?? null;
  const provisioningStartedAt = Date.now();
  state.provisioningStartedAtMs = provisioningStartedAt;
  const phaseDurations: Record<string, number> = {};
  const runPhase: RunProvisionPhase = async <T>(
    phase: ProvisionPhase,
    action: () => Promise<T>
  ): Promise<T> => {
    await assertCellStillExists(context, phase);

    const startedAt = Date.now();
    let phaseStatus: CellTimingStatus = "ok";
    let phaseError: string | null = null;
    try {
      return await action();
    } catch (error) {
      phaseStatus = "error";
      phaseError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      phaseDurations[phase] = durationMs;

      await insertProvisionTimingEvent(context, {
        step: phase,
        status: phaseStatus,
        durationMs,
        attempt,
        error: phaseError,
      });

      context.log.info?.(
        {
          cellId: state.cellId,
          templateId: template.id,
          attempt,
          phase,
          durationMs,
        },
        "Cell provisioning phase completed"
      );
    }
  };

  await runCreateWorktreePhase({
    context,
    runPhase,
    attempt,
  });

  if (!state.createdCell) {
    throw new Error("Cell record missing after worktree provisioning");
  }
  const createdCell: NonNullable<CellProvisionState["createdCell"]> =
    state.createdCell;

  const ensureServicesTimingWrites: Promise<void>[] = [];

  const persistEnsureServicesTimingEvent = (
    event: EnsureCellServicesTimingEvent
  ) => {
    ensureServicesTimingWrites.push(
      insertProvisionTimingEvent(context, {
        step: `ensure_services:${event.step}`,
        status: event.status,
        durationMs: event.durationMs,
        attempt,
        error: event.error ?? null,
        extraMetadata: event.metadata,
        createdAt: new Date(),
      })
    );
  };

  try {
    await runPhase("ensure_services", async () =>
      ensureServices({
        cell: createdCell,
        template,
        onTimingEvent: persistEnsureServicesTimingEvent,
      })
    );
  } finally {
    await settleProvisionTimingWrites({
      context,
      writes: ensureServicesTimingWrites,
      phase: "ensure_services",
    });
  }

  state.servicesStarted = true;

  const sessionOptions = buildAgentSessionOptions(body);
  const existingSessionId = state.createdCell?.opencodeSessionId ?? null;
  const session = await runPhase("ensure_agent_session", async () =>
    ensureSession(
      state.cellId,
      Object.keys(sessionOptions).length ? sessionOptions : undefined
    )
  );

  if (state.createdCell) {
    state.createdCell = {
      ...state.createdCell,
      opencodeSessionId: session.id,
    };
  }

  const initialPrompt = buildInitialPromptInput({
    title: body.name,
    description: body.description,
    images: body.initialPromptImages,
  });
  const shouldSendInitialPrompt = shouldSendInitialPromptForAttempt({
    attempt,
    hasInitialPrompt: Boolean(initialPrompt),
    existingSessionId,
  });
  if (shouldSendInitialPrompt && initialPrompt) {
    await runPhase("send_initial_prompt", () => {
      dispatchInitialPromptInBackground({
        sendAgentMessage: dispatchAgentMessage,
        sessionId: session.id,
        input: initialPrompt,
        timeoutMs: INITIAL_PROMPT_BACKGROUND_WARN_TIMEOUT_MS,
        cellId: state.cellId,
        log: context.log,
      });
      return Promise.resolve();
    });
  }

  const finishedAt = await runPhase("mark_ready", async () => {
    const updated = await updateCellProvisioningStatus(
      database,
      state.cellId,
      "ready",
      { lastSetupError: null, expectedStatus: "spawning" }
    );
    if (!updated) {
      await assertCellStillExists(context, "mark_ready");
      throw new Error(
        `${PROVISIONING_CANCELLED_MESSAGE} (phase: mark_ready, reason: status_changed)`
      );
    }
    return updated;
  });

  state.createdCell = {
    ...state.createdCell,
    status: "ready",
    lastSetupError: null,
  };

  if (state.provisioningState) {
    state.provisioningState = {
      ...state.provisioningState,
      finishedAt,
    };
  }

  context.log.info?.(
    {
      cellId: state.cellId,
      templateId: template.id,
      attempt,
      totalDurationMs: Date.now() - provisioningStartedAt,
      phaseDurations,
    },
    "Cell provisioning completed"
  );

  await insertProvisionTimingEvent(context, {
    step: "total",
    status: "ok",
    durationMs: Date.now() - provisioningStartedAt,
    attempt,
    extraMetadata: {
      phaseDurations,
    },
  });
  state.provisioningStartedAtMs = null;
}

async function handleDeferredProvisionFailure(
  context: ProvisionContext,
  error: unknown
): Promise<void> {
  const cancellationReason = await resolveProvisioningCancellationReason(
    context.database,
    context.state.cellId
  );
  if (cancellationReason) {
    await cleanupProvisionResources(context, { preserveRecord: true });
    context.log.info?.(
      {
        cellId: context.state.cellId,
        reason: cancellationReason,
      },
      PROVISIONING_CANCELLED_MESSAGE
    );
    return;
  }

  const payload = buildCellCreationErrorPayload(error);
  const lastSetupError = deriveSetupErrorDetails(payload);

  await stopServicesIfStarted(context, { preserveTerminal: true });

  const finishedAt = await updateCellProvisioningStatus(
    context.database,
    context.state.cellId,
    "error",
    { lastSetupError }
  );

  if (context.state.createdCell) {
    context.state.createdCell = {
      ...context.state.createdCell,
      status: "error",
      lastSetupError,
    };
  }

  if (context.state.provisioningState) {
    context.state.provisioningState = {
      ...context.state.provisioningState,
      finishedAt,
    };
  }

  if (context.state.provisioningStartedAtMs != null) {
    const totalDurationMs = Date.now() - context.state.provisioningStartedAtMs;
    await insertCellTimingEvent({
      database: context.database,
      log: context.log,
      cellId: context.state.cellId,
      cellName: context.state.createdCell?.name ?? context.body.name,
      workflow: "create",
      runId: context.state.timingRunId,
      step: "total",
      status: "error",
      durationMs: totalDurationMs,
      attempt: context.state.provisioningState?.attemptCount ?? null,
      error: lastSetupError,
      templateId: context.template.id,
      workspaceId: context.workspace.id,
    });
    context.state.provisioningStartedAtMs = null;
  }

  if (error instanceof Error) {
    context.log.error(error, "Cell provisioning failed after response");
  } else {
    context.log.error({ error }, "Cell provisioning failed after response");
  }
}

async function recoverCellCreationFailure(
  context: ProvisionContext,
  error: unknown
): Promise<CellCreationResult> {
  const payload = buildCellCreationErrorPayload(error);
  const preserveResources = shouldPreserveCellWorkspace(error);

  await insertProvisionTimingEvent(context, {
    step: "create_request_failure",
    status: "error",
    durationMs: 0,
    error: payload.message,
    attempt: context.state.provisioningState?.attemptCount ?? null,
  });

  if (
    preserveResources &&
    context.state.recordCreated &&
    context.state.createdCell
  ) {
    const lastSetupError = deriveSetupErrorDetails(payload);

    const finishedAt = await updateCellProvisioningStatus(
      context.database,
      context.state.cellId,
      "error",
      { lastSetupError }
    );

    await cleanupProvisionResources(context, {
      preserveRecord: true,
      preserveWorktree: true,
    });

    const erroredCell = {
      ...context.state.createdCell,
      status: "error",
      lastSetupError,
    };

    context.state.createdCell = erroredCell;
    if (context.state.provisioningState) {
      context.state.provisioningState = {
        ...context.state.provisioningState,
        finishedAt,
      };
    }

    return {
      status: HTTP_STATUS.CREATED,
      payload: cellToResponse(erroredCell),
    };
  }

  await cleanupProvisionResources(context);

  if (error instanceof Error) {
    context.log.error(error, "Failed to create cell");
  } else {
    context.log.error({ error }, "Failed to create cell");
  }

  return { status: HTTP_STATUS.INTERNAL_ERROR, payload };
}

async function cleanupProvisionResources(
  context: ProvisionContext,
  options: { preserveRecord?: boolean; preserveWorktree?: boolean } = {}
) {
  await runWithCellCleanupLock(context.state.cellId, async () => {
    if (!(await refreshProvisionCleanupState(context))) {
      return;
    }

    try {
      await cleanupProvisionResourcesUnlocked(context, options);
    } catch (error) {
      await markProvisionCleanupFailure(context, error);
      throw error;
    }
  });
}

async function cleanupProvisionResourcesUnlocked(
  context: ProvisionContext,
  options: { preserveRecord?: boolean; preserveWorktree?: boolean }
) {
  await stopServicesIfStarted(context);

  if (!options.preserveWorktree) {
    let cleanupError: unknown;
    try {
      await runProvisioningRollbackTeardown(context);
    } catch (error) {
      cleanupError = error;
    }
    try {
      await removeCellRuntimeDir(context.state.cellId);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) {
      throw cleanupError;
    }
    await removeWorktreeIfCreated(context);
  }

  if (!options.preserveRecord) {
    await deleteCellRecordIfCreated(context);
  }
}

async function refreshProvisionCleanupState(
  context: ProvisionContext
): Promise<boolean> {
  if (!context.state.recordCreated) {
    return true;
  }

  const [currentCell] = await context.database
    .select()
    .from(cells)
    .where(eq(cells.id, context.state.cellId))
    .limit(1);
  if (!currentCell) {
    context.state.recordCreated = false;
    context.state.createdCell = null;
    context.state.worktreeCreated = false;
    context.state.workspacePath = null;
    return false;
  }

  context.state.createdCell = currentCell;
  context.state.workspacePath = currentCell.workspacePath;
  context.state.baseCommit = currentCell.baseCommit;
  context.state.worktreeCreated = Boolean(
    currentCell.workspacePath && currentCell.baseCommit
  );
  return true;
}

async function markProvisionCleanupFailure(
  context: ProvisionContext,
  error: unknown
): Promise<void> {
  if (!context.state.recordCreated) {
    return;
  }

  const lastSetupError = `Provisioning cleanup failed: ${
    error instanceof Error ? error.message : String(error)
  }`;
  try {
    await updateCellProvisioningStatus(
      context.database,
      context.state.cellId,
      "error",
      { lastSetupError }
    );
    if (context.state.createdCell) {
      context.state.createdCell = {
        ...context.state.createdCell,
        status: "error",
        lastSetupError,
      };
    }
  } catch (statusError) {
    context.log.warn(
      { statusError, cleanupError: error },
      "Failed to persist cell provisioning cleanup failure"
    );
  }
}

async function runProvisioningRollbackTeardown(
  context: ProvisionContext
): Promise<void> {
  if (!(context.state.worktreeCreated && context.state.createdCell)) {
    return;
  }

  await context.runCellTeardown({
    cell: context.state.createdCell,
    template: context.template,
    reason: "provisioning_rollback",
  });
}

async function resolveProvisioningCancellationReason(
  database: DatabaseClient,
  cellId: string
): Promise<"missing" | "deleting" | null> {
  const record = await database
    .select({ id: cells.id, status: cells.status })
    .from(cells)
    .where(eq(cells.id, cellId))
    .limit(1);
  const [current] = record;

  if (!current) {
    return "missing";
  }

  if (current.status === "deleting") {
    return "deleting";
  }

  return null;
}

async function assertCellStillExists(
  context: ProvisionContext,
  phase: ProvisionPhase
): Promise<void> {
  const cancellationReason = await resolveProvisioningCancellationReason(
    context.database,
    context.state.cellId
  );
  if (!cancellationReason) {
    return;
  }

  throw new Error(
    `${PROVISIONING_CANCELLED_MESSAGE} (phase: ${phase}, reason: ${cancellationReason})`
  );
}

async function stopServicesIfStarted(
  context: ProvisionContext,
  options: { preserveTerminal?: boolean } = {}
) {
  if (!(context.state.servicesStarted || context.state.worktreeCreated)) {
    return;
  }

  await context.stopCellServices(context.state.cellId, {
    ...(options.preserveTerminal ? { preserveTerminal: true } : {}),
    releasePorts: true,
  });
  context.state.servicesStarted = false;
}

async function removeWorktreeIfCreated(context: ProvisionContext) {
  if (!(context.state.worktreeCreated && context.state.workspacePath)) {
    return;
  }

  const worktreeService = await context.getWorktreeService();

  await removeCellWorkspace(
    worktreeService,
    {
      id: context.state.cellId,
      workspacePath: context.state.workspacePath,
      workspaceRootPath: context.workspace.path,
    },
    context.log
  );

  context.state.worktreeCreated = false;
  context.state.workspacePath = null;
}

async function deleteCellRecordIfCreated(context: ProvisionContext) {
  if (!context.state.recordCreated) {
    return;
  }

  try {
    await context.database
      .delete(cells)
      .where(eq(cells.id, context.state.cellId));
  } catch (cleanupError) {
    context.log.warn(
      { cleanupError },
      "Failed to delete cell row during cleanup"
    );
  } finally {
    context.state.recordCreated = false;
    context.state.createdCell = null;
    context.state.provisioningState = null;
  }
}

function decodeBase64Data(base64Data: string): Buffer {
  const decoded = Buffer.from(base64Data, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== base64Data) {
    throw new Error("Invalid base64 data");
  }

  return decoded;
}

function sanitizeInitialPromptImage(
  image: unknown,
  index: number
): CreateCellImageInput {
  if (typeof image !== "object" || image === null) {
    throw new Error(`Initial prompt image ${index + 1} is invalid`);
  }

  const mimeType = (image as { mimeType?: unknown }).mimeType;
  const rawBase64Data = (image as { base64Data?: unknown }).base64Data;
  const rawFilename = (image as { filename?: unknown }).filename;

  if (typeof mimeType !== "string") {
    throw new Error(`Initial prompt image ${index + 1} is missing a MIME type`);
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error(
      `Initial prompt image ${index + 1} must use an image MIME type`
    );
  }

  const narrowedMimeType = mimeType as CreateCellImageInput["mimeType"];

  if (typeof rawBase64Data !== "string") {
    throw new Error(`Initial prompt image ${index + 1} is missing image data`);
  }

  const base64Data = rawBase64Data.trim();
  if (!BASE64_DATA_PATTERN.test(base64Data)) {
    throw new Error(`Initial prompt image ${index + 1} is not valid base64`);
  }

  if (decodeBase64Data(base64Data).byteLength < 1) {
    throw new Error(`Initial prompt image ${index + 1} is empty`);
  }

  const filename =
    typeof rawFilename === "string" ? rawFilename.trim() : undefined;
  return {
    mimeType: narrowedMimeType,
    base64Data,
    ...(filename ? { filename } : {}),
  } satisfies CreateCellImageInput;
}

function sanitizeInitialPromptImages(
  images?: CreateCellRequest["initialPromptImages"]
): CreateCellRequest["initialPromptImages"] {
  if (!images?.length) {
    return;
  }

  return images.map((image, index) => sanitizeInitialPromptImage(image, index));
}

function serializeInitialPromptImages(
  images?: CreateCellRequest["initialPromptImages"]
): string | null {
  if (!images?.length) {
    return null;
  }

  return JSON.stringify(images);
}

function parseInitialPromptImages(
  value: string | null | undefined
): CreateCellRequest["initialPromptImages"] {
  if (!value) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored initial prompt images are invalid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Stored initial prompt images must be an array");
  }

  return sanitizeInitialPromptImages(
    parsed as CreateCellRequest["initialPromptImages"]
  );
}

function resolveProvisioningParams(
  cell: typeof cells.$inferSelect,
  provisioningState?: CellProvisioningState | null
): CreateCellRequest {
  return {
    name: cell.name,
    ...(cell.description != null ? { description: cell.description } : {}),
    ...(provisioningState?.initialPromptImagesJson
      ? {
          initialPromptImages: parseInitialPromptImages(
            provisioningState.initialPromptImagesJson
          ),
        }
      : {}),
    templateId: cell.templateId,
    workspaceId: cell.workspaceId,
    ...(provisioningState?.modelIdOverride != null
      ? { modelId: provisioningState.modelIdOverride }
      : {}),
    ...(provisioningState?.providerIdOverride != null
      ? { providerId: provisioningState.providerIdOverride }
      : {}),
    ...(provisioningState?.variantOverride != null
      ? { variant: provisioningState.variantOverride }
      : {}),
    ...(provisioningState?.startMode != null
      ? { startMode: normalizeStartMode(provisioningState.startMode) }
      : {}),
  };
}

function shouldSendInitialPromptForAttempt(args: {
  attempt: number | null;
  hasInitialPrompt: boolean;
  existingSessionId: string | null;
}): boolean {
  if (!args.hasInitialPrompt) {
    return false;
  }

  if (args.attempt === 1) {
    return true;
  }

  return !args.existingSessionId;
}

function buildInitialPromptInput(args: {
  title?: string | null;
  description?: string | null;
  images?: CreateCellRequest["initialPromptImages"];
}): AgentPromptInput | undefined {
  const title = args.title?.trim();
  const description = args.description?.trim();
  const parts: AgentPromptInput["parts"] = [];

  if (description) {
    parts.push({
      type: "text",
      text: title ? `${title}\n\n${description}` : description,
    });
  }

  for (const image of args.images ?? []) {
    parts.push({
      type: "file",
      mime: image.mimeType,
      url: `data:${image.mimeType};base64,${image.base64Data}`,
      ...(image.filename ? { filename: image.filename } : {}),
    });
  }

  if (parts.length === 0) {
    return;
  }

  return { parts };
}

function buildAgentSessionOptions(body: Static<typeof CreateCellSchema>) {
  return {
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.providerId ? { providerId: body.providerId } : {}),
    ...(body.variant ? { variant: body.variant } : {}),
    ...(body.startMode ? { startMode: body.startMode } : {}),
  };
}

function dispatchInitialPromptInBackground(args: {
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  sessionId: string;
  input: AgentPromptInput;
  timeoutMs: number;
  cellId: string;
  log: LoggerLike;
}): void {
  const promptStartedAt = Date.now();
  const promptDispatch = args.sendAgentMessage(args.sessionId, args.input);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    args.log.warn(
      {
        cellId: args.cellId,
        sessionId: args.sessionId,
        timeoutMs: args.timeoutMs,
        elapsedMs: Date.now() - promptStartedAt,
      },
      "Initial prompt is still running after startup finalized"
    );
  }, args.timeoutMs);

  promptDispatch.then(
    () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    },
    (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      args.log.warn(
        {
          cellId: args.cellId,
          sessionId: args.sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Initial prompt failed after startup finalized"
      );
    }
  );
}

type LoggerLike = {
  info?(obj: Record<string, unknown>, message?: string): void;
  warn(obj: Record<string, unknown>, message?: string): void;
  error(obj: Record<string, unknown> | Error, message?: string): void;
};

const backgroundProvisioningLogger: LoggerLike = {
  info: () => {
    /* noop */
  },
  warn: () => {
    /* noop */
  },
  error: () => {
    /* noop */
  },
};

const resumeSingleCell = async (
  deps: CellRouteDependencies,
  cell: typeof cells.$inferSelect,
  provisioningState: typeof cellProvisioningStates.$inferSelect | null
) => {
  try {
    const attemptCount = provisioningState?.attemptCount ?? 0;
    if (attemptCount >= MAX_PROVISIONING_ATTEMPTS) {
      await updateCellProvisioningStatus(deps.db, cell.id, "error", {
        lastSetupError: `${PROVISIONING_INTERRUPTED_MESSAGE}\nRetry limit exceeded.`,
      });
      return;
    }

    const workspaceContext = await resolveWorkspaceContextFromDeps(
      deps.resolveWorkspaceContext,
      cell.workspaceId
    );
    const hiveConfig = await workspaceContext.loadConfig();

    const template = hiveConfig.templates[cell.templateId];
    if (!template) {
      await updateCellProvisioningStatus(deps.db, cell.id, "error", {
        lastSetupError: `${PROVISIONING_INTERRUPTED_MESSAGE}\nTemplate ${cell.templateId} no longer exists.`,
      });
      return;
    }

    const context = createExistingProvisionContext({
      cell,
      provisioningState,
      body: resolveProvisioningParams(cell, provisioningState),
      template,
      database: deps.db,
      ensureSession: deps.ensureAgentSession,
      sendAgentMessage: deps.sendAgentMessage,
      ensureServices: deps.ensureServicesForCell,
      stopCellServices: deps.stopServicesForCell,
      runCellTeardown: deps.runCellTeardown,
      workspaceContext,
      log: backgroundProvisioningLogger,
    });

    startProvisioningWorkflow(context);
  } catch (error) {
    await updateCellProvisioningStatus(deps.db, cell.id, "error", {
      lastSetupError: `${PROVISIONING_INTERRUPTED_MESSAGE}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
};

const resumePendingCells = async (deps: CellRouteDependencies) => {
  const pendingCells = await deps.db
    .select({
      cell: cells,
      provisioningState: cellProvisioningStates,
    })
    .from(cells)
    .innerJoin(
      cellProvisioningStates,
      eq(cellProvisioningStates.cellId, cells.id)
    )
    .where(eq(cells.status, "spawning"));

  for (const { cell, provisioningState } of pendingCells) {
    await resumeSingleCell(deps, cell, provisioningState);
  }
};

const resumeDeletingCells = async (deps: CellRouteDependencies) => {
  const deletingCells = await deps.db
    .select()
    .from(cells)
    .where(eq(cells.status, "deleting"));

  if (deletingCells.length === 0) {
    return;
  }

  const fetchManager = createWorktreeManagerFetcher(
    deps.resolveWorkspaceContext
  );

  for (const cell of deletingCells) {
    try {
      await deleteCellWithLifecycle({
        ...buildDeletionDependencies(deps),
        cell,
        getWorktreeService: fetchManager,
        log: backgroundProvisioningLogger,
      });
    } catch {
      // best-effort startup recovery: failed deletes restore cells to error status
    }
  }
};

export async function resumeSpawningCells(
  overrides: Partial<CellRouteDependencies> = {}
): Promise<void> {
  const deps = await resolveCellRouteDependencies(overrides);
  await resumePendingCells(deps);
  await resumeDeletingCells(deps);
}

const reviveTemplateSetupError = (
  error: unknown
): TemplateSetupError | null => {
  if (error instanceof TemplateSetupError) {
    return error;
  }

  if (
    isNamedErrorLike(error, "TemplateSetupError") &&
    typeof (error as { command?: unknown }).command === "string" &&
    typeof (error as { templateId?: unknown }).templateId === "string" &&
    typeof (error as { workspacePath?: unknown }).workspacePath === "string"
  ) {
    const templateLike = error as {
      command: string;
      templateId: string;
      workspacePath: string;
      cause?: unknown;
      exitCode?: number;
    };

    return new TemplateSetupError({
      command: templateLike.command,
      templateId: templateLike.templateId,
      workspacePath: templateLike.workspacePath,
      cause: templateLike.cause,
      exitCode:
        typeof templateLike.exitCode === "number"
          ? templateLike.exitCode
          : undefined,
    });
  }

  return null;
};

const isNamedErrorLike = (error: unknown, name: string) =>
  Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === name
  );

const reviveCommandExecutionError = (
  error: unknown
): CommandExecutionError | null => {
  if (error instanceof CommandExecutionError) {
    return error;
  }

  if (
    isNamedErrorLike(error, "CommandExecutionError") &&
    typeof (error as { command?: unknown }).command === "string" &&
    typeof (error as { cwd?: unknown }).cwd === "string" &&
    typeof (error as { exitCode?: unknown }).exitCode === "number"
  ) {
    const commandLike = error as {
      command: string;
      cwd: string;
      exitCode: number;
    };

    return new CommandExecutionError(commandLike);
  }

  return null;
};

const normalizeFailureError = (error: unknown): unknown => {
  const unwrapped = unwrapSupervisorError(error);
  return (
    reviveTemplateSetupError(unwrapped) ??
    reviveCommandExecutionError(unwrapped) ??
    unwrapped
  );
};

function shouldPreserveCellWorkspace(
  error: unknown
): error is TemplateSetupError {
  const underlying = normalizeFailureError(error);
  return underlying instanceof TemplateSetupError;
}

function deriveSetupErrorDetails(payload: ErrorPayload): string {
  const details = payload.details?.trim();
  return details?.length ? details : payload.message;
}

async function updateCellProvisioningStatus(
  database: DatabaseClient,
  cellId: string,
  status: CellStatus,
  options: {
    lastSetupError?: string | null;
    expectedStatus?: CellStatus;
  } = {}
): Promise<Date | null> {
  const finished = status === "ready" || status === "error";
  const finishedAt = finished ? new Date() : null;
  const [updated] = await database
    .update(cells)
    .set({ status, lastSetupError: options.lastSetupError ?? null })
    .where(
      and(
        eq(cells.id, cellId),
        options.expectedStatus
          ? eq(cells.status, options.expectedStatus)
          : undefined
      )
    )
    .returning({ workspaceId: cells.workspaceId });

  if (!updated) {
    return null;
  }

  if (finishedAt) {
    await database
      .update(cellProvisioningStates)
      .set({ finishedAt })
      .where(eq(cellProvisioningStates.cellId, cellId));
  }

  emitCellStatusUpdate({
    workspaceId: updated.workspaceId,
    cellId,
    status,
    lastSetupError: options.lastSetupError,
  });

  return finishedAt;
}

const buildTemplateSetupErrorPayload = (
  error: unknown
): ErrorPayload | null => {
  if (!(error instanceof TemplateSetupError)) {
    return null;
  }

  const details = [
    `Template ID: ${error.templateId}`,
    `Workspace: ${error.workspacePath}`,
    `Command: ${error.command}`,
  ];

  let exitCode: number | undefined;
  if (typeof error.exitCode === "number") {
    exitCode = error.exitCode;
  } else {
    const causeError = unwrapSupervisorError(error.cause);
    const nestedCommandError = reviveCommandExecutionError(causeError);
    if (nestedCommandError) {
      exitCode = nestedCommandError.exitCode;
    } else if (
      causeError &&
      typeof causeError === "object" &&
      typeof (causeError as { exitCode?: unknown }).exitCode === "number"
    ) {
      exitCode = (causeError as { exitCode: number }).exitCode;
    }
  }

  if (typeof exitCode === "number") {
    details.push(`exit code ${exitCode}`);
  }

  const causeMessage =
    error.cause instanceof Error ? error.cause.message.trim() : "";
  if (causeMessage.length > 0) {
    details.push(`Reason: ${causeMessage}`);
  }

  const stack = formatStackTrace(error);
  const causeStack = formatStackTrace(
    error.cause instanceof Error ? error.cause : undefined
  );

  if (stack) {
    details.push("", stack);
  }

  if (causeStack && causeStack !== stack) {
    details.push("", `Caused by:\n${causeStack}`);
  }

  return { message: error.message, details: details.join("\n") };
};

const buildCommandExecutionErrorPayload = (
  error: unknown
): ErrorPayload | null => {
  if (!(error instanceof CommandExecutionError)) {
    return null;
  }

  const details = [
    `Command: ${error.command}`,
    `cwd: ${error.cwd}`,
    `Exit code: ${error.exitCode}`,
  ];

  const stack = formatStackTrace(error);
  if (stack) {
    details.push("", stack);
  }

  return { message: error.message, details: details.join("\n") };
};

function buildCellCreationErrorPayload(error: unknown): ErrorPayload {
  const underlyingError = normalizeFailureError(error);

  const templatePayload = buildTemplateSetupErrorPayload(underlyingError);
  if (templatePayload) {
    return templatePayload;
  }

  const commandPayload = buildCommandExecutionErrorPayload(underlyingError);
  if (commandPayload) {
    return commandPayload;
  }

  if (underlyingError instanceof Error) {
    const stack = formatStackTrace(underlyingError);
    return stack
      ? { message: underlyingError.message, details: stack }
      : { message: underlyingError.message };
  }

  return { message: "Failed to create cell" };
}

function formatStackTrace(error?: Error): string | undefined {
  if (!error) {
    return;
  }

  return error.stack ?? error.message;
}

function resolveSetupRetryCell(
  cell: typeof cells.$inferSelect | null
):
  | { ok: true; cell: typeof cells.$inferSelect }
  | { ok: false; status: number; message: string } {
  if (!cell) {
    return {
      ok: false,
      status: HTTP_STATUS.NOT_FOUND,
      message: "Cell not found",
    };
  }

  if (cell.status === "deleting") {
    return {
      ok: false,
      status: HTTP_STATUS.CONFLICT,
      message: "Cell is being deleted",
    };
  }

  return { ok: true, cell };
}

function shouldEmitCellRemovalEvent(
  cell: typeof cells.$inferSelect | null
): boolean {
  if (!cell) {
    return true;
  }

  return cell.status === "deleting";
}

async function resolveWorkspaceCellStreamEvent(args: {
  database: DatabaseClient;
  event: CellStatusEvent;
  log: LoggerLike;
}): Promise<
  | { event: "cell"; data: ReturnType<typeof cellToResponse> }
  | { event: "cell_removed"; data: { id: string } }
  | null
> {
  try {
    const cell = await loadCellById(args.database, args.event.cellId);
    if (shouldEmitCellRemovalEvent(cell)) {
      return {
        event: "cell_removed",
        data: { id: args.event.cellId },
      };
    }

    if (!cell) {
      return null;
    }

    return {
      event: "cell",
      data: cellToResponse(cell),
    };
  } catch (error) {
    args.log.error(
      { error, cellId: args.event.cellId },
      "Failed to stream cell update"
    );
    return null;
  }
}

function fetchServiceRows(
  database: DatabaseClient,
  cellId: string
): Promise<ServiceRow[]> {
  return database
    .select({ service: cellServices, cell: cells })
    .from(cellServices)
    .innerJoin(cells, eq(cells.id, cellServices.cellId))
    .where(eq(cellServices.cellId, cellId));
}

async function fetchServiceRow(
  database: DatabaseClient,
  cellId: string,
  serviceId: string
): Promise<ServiceRow | null> {
  const [row] = await database
    .select({ service: cellServices, cell: cells })
    .from(cellServices)
    .innerJoin(cells, eq(cells.id, cellServices.cellId))
    .where(and(eq(cellServices.cellId, cellId), eq(cellServices.id, serviceId)))
    .limit(1);

  return row ?? null;
}

function sampleServiceResources(
  deps: CellRouteDependencies,
  rows: ServiceRow[]
): Promise<Map<number, ProcessResourceSnapshot>> {
  return sampleResourcesByPid(
    deps,
    rows
      .map((row) => deriveTrackedServiceProcess(deps, row).pid)
      .filter((pid): pid is number => Number.isInteger(pid) && (pid ?? 0) > 0)
  );
}

function sampleResourcesByPid(
  deps: CellRouteDependencies,
  pids: number[]
): Promise<Map<number, ProcessResourceSnapshot>> {
  const deduplicated = Array.from(
    new Set(
      pids.filter((pid): pid is number => Number.isInteger(pid) && pid > 0)
    )
  );

  if (deduplicated.length === 0) {
    return Promise.resolve(new Map<number, ProcessResourceSnapshot>());
  }

  return deps.sampleServiceResources(deduplicated);
}

type ResourceProcessKind = "service" | "opencode" | "terminal" | "setup";

type ResourceTrackedProcess = {
  kind: ResourceProcessKind;
  serviceType?: string;
  id: string;
  name: string;
  status: string;
  pid: number | null;
  processAlive: boolean;
  active: boolean;
};

const isServiceRuntimeActive = (status: string): boolean =>
  status === "running" || status === "starting" || status === "needs_resume";

function deriveTrackedServiceProcess(
  deps: CellRouteDependencies,
  row: ServiceRow
): ResourceTrackedProcess {
  const runtimeSession = deps.getServiceTerminalSession(row.service.id);
  const processAlive =
    runtimeSession?.status === "running" || isProcessAlive(row.service.pid);

  let status = row.service.status;
  if (row.service.status === "running" && !processAlive) {
    status = "error";
  } else if (row.service.status === "error" && processAlive) {
    status = "running";
  }

  let pid: number | null = null;
  if (runtimeSession?.status === "running") {
    pid = runtimeSession.pid;
  } else if (processAlive) {
    pid = row.service.pid ?? null;
  }

  return {
    kind: "service",
    serviceType: row.service.type,
    id: row.service.id,
    name: row.service.name,
    status,
    pid,
    processAlive,
    active: processAlive && isServiceRuntimeActive(status),
  };
}

type SerializeServiceOptions = {
  logOptions?: LogTailOptions;
  includeResources?: boolean;
  resourcesByPid?: Map<number, ProcessResourceSnapshot>;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: normalizes persisted service state against runtime process state.
async function serializeService(
  deps: CellRouteDependencies,
  database: DatabaseClient,
  row: ServiceRow,
  options?: SerializeServiceOptions
) {
  const includeResources = options?.includeResources ?? false;
  const { service } = row;
  const output = deps.readServiceTerminalOutput(service.id);
  const logResult = readOutputTail(
    output.length > 0 ? output : null,
    options?.logOptions
  );
  const runtimeSession = deps.getServiceTerminalSession(service.id);
  const processAlive =
    runtimeSession?.status === "running" || isProcessAlive(service.pid);
  const persistedPorts = await database
    .select()
    .from(cellServicePorts)
    .where(eq(cellServicePorts.serviceId, service.id));
  const processDefinition =
    service.definition.type === "process"
      ? (service.definition as ProcessService)
      : null;
  const protocolForPort = (portName: string) =>
    resolveServicePortProtocol(
      processDefinition ?? {},
      portName,
      DEFAULT_SERVICE_PROTOCOL
    );
  const legacyPortClaims =
    service.port == null
      ? []
      : [{ name: "default", port: service.port, primary: true }];
  const portClaims =
    persistedPorts.length > 0 ? persistedPorts : legacyPortClaims;
  const normalizedPorts = (
    await Promise.all(
      portClaims.map(async (claim) => {
        const protocol = protocolForPort(claim.name);
        return {
          name: claim.name,
          port: claim.port,
          primary: claim.primary,
          protocol,
          viewer: resolveServicePortViewer(processDefinition ?? {}, claim.name),
          url: buildServiceUrl(claim.port, protocol) ?? undefined,
          portReachable: await isPortActive(claim.port),
        };
      })
    )
  ).sort(
    (left, right) =>
      Number(right.primary) - Number(left.primary) ||
      left.name.localeCompare(right.name)
  );
  const primaryPort =
    normalizedPorts.find((claim) => claim.primary)?.port ?? service.port;
  const primaryProtocol =
    normalizedPorts.find((claim) => claim.primary)?.protocol ?? "http";
  const portReachable = normalizedPorts.find(
    (claim) => claim.port === primaryPort
  )?.portReachable;
  const serviceUrl = buildServiceUrl(primaryPort, primaryProtocol);

  let derivedStatus = service.status;
  let derivedLastKnownError = service.lastKnownError;

  if (service.status === "running" && !processAlive) {
    derivedStatus = "error";
    derivedLastKnownError =
      service.lastKnownError ?? "Process exited unexpectedly";
  } else if (service.status === "error" && processAlive) {
    derivedStatus = "running";
    derivedLastKnownError = null;
  }

  let derivedPid: number | null = null;
  if (runtimeSession?.status === "running") {
    derivedPid = runtimeSession.pid;
  } else if (processAlive) {
    derivedPid = service.pid;
  }

  const resourceSnapshot = includeResources
    ? (() => {
        const resourceSampledAt = new Date().toISOString();
        if (!derivedPid) {
          return {
            cpuPercent: null,
            rssBytes: null,
            resourceSampledAt,
            resourceUnavailableReason:
              typeof service.pid === "number" && !processAlive
                ? "process_not_alive"
                : "pid_missing",
          } satisfies ProcessResourceSnapshot;
        }

        if (!processAlive) {
          return {
            cpuPercent: null,
            rssBytes: null,
            resourceSampledAt,
            resourceUnavailableReason: "process_not_alive",
          } satisfies ProcessResourceSnapshot;
        }

        return (
          options?.resourcesByPid?.get(derivedPid) ?? {
            cpuPercent: null,
            rssBytes: null,
            resourceSampledAt,
            resourceUnavailableReason: "sample_failed",
          }
        );
      })()
    : null;

  const shouldPersist =
    derivedStatus !== service.status ||
    derivedLastKnownError !== service.lastKnownError ||
    derivedPid !== (service.pid ?? null);

  if (shouldPersist) {
    await database
      .update(cellServices)
      .set({
        status: derivedStatus,
        lastKnownError: derivedLastKnownError,
        pid: derivedPid,
        updatedAt: new Date(),
      })
      .where(eq(cellServices.id, service.id));
  }

  return {
    id: service.id,
    name: service.name,
    type: service.type,
    status: derivedStatus,
    ...(primaryPort != null ? { port: primaryPort } : {}),
    ...(serviceUrl ? { url: serviceUrl } : {}),
    ports: normalizedPorts,
    ...(derivedPid != null ? { pid: derivedPid } : {}),
    command: service.command,
    cwd: service.cwd,
    logPath: null,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    audio: processDefinition?.audio,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs: logResult.content,
    totalLogLines: logResult.totalLines,
    hasMoreLogs: logResult.hasMore,
    processAlive,
    ...(portReachable !== undefined ? { portReachable } : {}),
    ...(resourceSnapshot
      ? {
          cpuPercent: resourceSnapshot.cpuPercent,
          rssBytes: resourceSnapshot.rssBytes,
          resourceSampledAt: resourceSnapshot.resourceSampledAt,
          ...(resourceSnapshot.resourceUnavailableReason
            ? {
                resourceUnavailableReason:
                  resourceSnapshot.resourceUnavailableReason,
              }
            : {}),
        }
      : {}),
  };
}

type LogTailOptions = {
  /** Maximum number of lines to return (default: 200, max: 2000) */
  lines?: number;
  /** Number of lines to skip from the end before taking `lines` (default: 0) */
  offset?: number;
};

type LogTailResult = {
  content: string | null;
  /** Total number of lines in the file (approximate for large files) */
  totalLines: number | null;
  /** Whether there are more lines before the returned content */
  hasMore: boolean;
};

function readOutputTail(
  output?: string | null,
  options?: LogTailOptions
): LogTailResult {
  if (output == null) {
    return { content: null, totalLines: null, hasMore: false };
  }

  const normalizedOutput = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines =
    normalizedOutput.length > 0
      ? normalizedOutput.split(LOG_LINE_SPLIT_RE)
      : [];

  const requestedLines = Math.min(
    Math.max(options?.lines ?? LOG_TAIL_MAX_LINES, 1),
    LOG_TAIL_API_MAX_LINES
  );
  const offset = Math.max(options?.offset ?? 0, 0);

  const endIndex = Math.max(allLines.length - offset, 0);
  const startIndex = Math.max(endIndex - requestedLines, 0);
  const selectedLines = allLines.slice(startIndex, endIndex);

  return {
    content: selectedLines.join("\n").trimEnd(),
    totalLines: allLines.length,
    hasMore: startIndex > 0,
  };
}

function buildSetupLogPayload(
  cellId: string,
  deps: CellRouteDependencies,
  logOptions?: LogTailOptions
) {
  const output = deps.readSetupTerminalOutput(cellId);
  const logResult = readOutputTail(
    output.length > 0 ? output : null,
    logOptions
  );
  return {
    ...(logResult.content != null ? { setupLog: logResult.content } : {}),
  };
}

function deriveSetupTerminalState(
  cell: typeof cells.$inferSelect,
  session: ServiceTerminalSession | null
): "active" | "completed" | "failed" | "pending" {
  if (session?.status === "running") {
    return "active";
  }

  if (cell.lastSetupError) {
    return "failed";
  }

  if (cell.status === "ready") {
    return "completed";
  }

  return "pending";
}
