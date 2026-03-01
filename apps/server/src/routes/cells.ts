import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";

import { logger } from "@bogeychan/elysia-logger";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Elysia, type Static, sse, t } from "elysia";
import { loadOpencodeConfig } from "../agents/opencode-config";
import { getSharedOpencodeServerBaseUrl } from "../agents/opencode-server";
import type { AgentRuntimeService } from "../agents/service";
import { agentRuntimeService } from "../agents/service";
import type { AgentMode } from "../agents/types";
import type { Template } from "../config/schema";
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
import { type CellStatus, cells, type NewCell } from "../schema/cells";
import { cellServices } from "../schema/services";
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
import {
  deleteCellWithLifecycle,
  removeCellWorkspace,
} from "../services/cell-delete-lifecycle";
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
  describeWorktreeError,
  toAsyncWorktreeManager,
  type WorktreeCreateTimingEvent,
  type WorktreeManagerError,
} from "../worktree/manager";

type DatabaseClient = DatabaseServiceType["db"];

type WorkspaceContextResolverLike = (
  workspaceId?: string
) => WorkspaceRuntimeContext | Promise<WorkspaceRuntimeContext>;

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

export type CellRouteDependencies = {
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
  ensureTerminalSession: (args: {
    cellId: string;
    workspacePath: string;
  }) => CellTerminalSession;
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
    preferredModel?: { providerId: string; modelId: string };
    startMode?: AgentMode;
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
];

const buildDefaultCellDependencies = (): CellRouteDependencies => {
  const { db: database } = DatabaseService;
  const agentRuntime = agentRuntimeService;
  const supervisor = ServiceSupervisorService;
  const terminal = cellTerminalService;
  const chatTerminal = chatTerminalService;

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
    ensureTerminalSession: terminal.ensureSession,
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
  const rows = await args.database
    .select()
    .from(cellTimingEvents)
    .where(
      and(
        args.cellId ? eq(cellTimingEvents.cellId, args.cellId) : undefined,
        args.workflow
          ? eq(cellTimingEvents.workflow, args.workflow)
          : undefined,
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

const LOG_TAIL_MAX_LINES = 200;
const LOG_TAIL_API_MAX_LINES = 2000;
const LOG_LINE_SPLIT_RE = /\r?\n/;
const PORT_CHECK_TIMEOUT_MS = 500;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_PROVISIONING_ATTEMPTS = 3;
const INITIAL_PROMPT_BACKGROUND_WARN_TIMEOUT_MS = 3000;
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
type OpencodeThemeMode = "dark" | "light";
const ChatThemeModeQuerySchema = t.Object({
  themeMode: t.Optional(t.Union([t.Literal("dark"), t.Literal("light")])),
});

const PROVISIONING_INTERRUPTED_MESSAGE =
  "Provisioning interrupted. Fix the workspace and rerun setup.";
const PROVISIONING_CANCELLED_MESSAGE =
  "Provisioning cancelled because the cell no longer exists.";

const activeProvisioningWorkflows = new Set<string>();

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
} as const;

function buildServiceUrl(port?: number | null) {
  if (typeof port !== "number") {
    return null;
  }
  return `${DEFAULT_SERVICE_PROTOCOL}://${DEFAULT_SERVICE_HOST}:${port}`;
}

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

function normalizeStartMode(value: string | undefined): AgentMode | undefined {
  if (value === "plan" || value === "build") {
    return value;
  }

  return;
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
    const mergedConfig = await loadOpencodeConfig(args.workspaceRootPath);
    const candidate = (mergedConfig.config as { default_agent?: unknown })
      .default_agent;
    if (typeof candidate === "string") {
      const normalized = normalizeStartMode(candidate);
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
  const existingSession = chatTerminal.getChatTerminalSession(cell.id);
  if (existingSession?.status === "running") {
    return {
      session: existingSession,
      chatTerminal,
    };
  }

  const agentSession = await deps.ensureAgentSession(cell.id);
  const preferredProviderId =
    agentSession.modelProviderId ?? agentSession.provider;
  const startMode = agentSession.currentMode ?? agentSession.startMode;
  const preferredModel =
    agentSession.modelId && preferredProviderId
      ? {
          modelId: agentSession.modelId,
          providerId: preferredProviderId,
        }
      : undefined;
  const session = chatTerminal.ensureChatTerminalSession({
    cellId: cell.id,
    workspacePath: cell.workspacePath,
    opencodeSessionId: agentSession.id,
    opencodeServerUrl: serverUrl,
    opencodeThemeMode: themeMode,
    preferredModel,
    ...(startMode ? { startMode } : {}),
  });

  return {
    session,
    chatTerminal,
  };
}

function isCellReadyForChat(cell: typeof cells.$inferSelect): boolean {
  return cell.status === "ready";
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

          await deps.db
            .update(cells)
            .set({ status: "spawning", lastSetupError: null })
            .where(eq(cells.id, cell.id));

          emitCellStatusUpdate({
            workspaceId: cell.workspaceId,
            cellId: cell.id,
            status: "spawning",
            lastSetupError: null,
          });

          const context = await createExistingProvisionContext({
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
          await deps.db
            .update(cells)
            .set({ status: "error", lastSetupError })
            .where(eq(cells.id, cell.id));

          emitCellStatusUpdate({
            workspaceId: cell.workspaceId,
            cellId: cell.id,
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
        params: t.Object({ id: t.String() }),
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
          404: t.Object({ message: t.String() }),
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
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const logOptions: LogTailOptions = {
          lines: query.logLines,
          offset: query.logOffset,
        };

        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(deps, database, row, logOptions))
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
      {
        params: t.Object({ id: t.String() }),
        query: ServiceLogQuerySchema,
        response: {
          200: CellServiceListResponseSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .get(
      "/:id/activity",
      async ({ params, query, set }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return {
            message: "Cell not found",
          } satisfies { message: string };
        }

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
      {
        params: t.Object({ id: t.String() }),
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
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .get(
      "/timings/global",
      async ({ query }) => {
        const { db: database } = await resolveDeps();
        const workflow = normalizeTimingWorkflow(query.workflow);
        const limit = normalizeTimingLimit(query.limit);

        const steps = await fetchTimingSteps({
          database,
          workflow,
          runId: query.runId,
          workspaceId: query.workspaceId,
          cellId: query.cellId,
        });

        return toTimingListResponse(steps, limit);
      },
      {
        query: t.Object({
          limit: t.Optional(
            t.Number({
              minimum: 1,
              maximum: MAX_TIMING_LIMIT,
              default: DEFAULT_TIMING_LIMIT,
            })
          ),
          workflow: t.Optional(
            t.Union([
              t.Literal("create"),
              t.Literal("delete"),
              t.Literal("all"),
            ])
          ),
          runId: t.Optional(t.String()),
          workspaceId: t.Optional(t.String()),
          cellId: t.Optional(t.String()),
        }),
        response: {
          200: CellTimingListResponseSchema,
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
        params: t.Object({ id: t.String() }),
        query: t.Object({
          limit: t.Optional(
            t.Number({
              minimum: 1,
              maximum: MAX_TIMING_LIMIT,
              default: DEFAULT_TIMING_LIMIT,
            })
          ),
          workflow: t.Optional(
            t.Union([
              t.Literal("create"),
              t.Literal("delete"),
              t.Literal("all"),
            ])
          ),
          runId: t.Optional(t.String()),
        }),
        response: {
          200: CellTimingListResponseSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .get(
      "/:id/timings/stream",
      async ({ params, query, request, set }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const workflow = normalizeTimingWorkflow(query.workflow);
        const { iterator, cleanup } = createAsyncEventIterator<CellTimingEvent>(
          (listener) => subscribeToCellTimingEvents(params.id, listener),
          request.signal
        );

        async function* stream() {
          try {
            yield sse({ event: "ready", data: { timestamp: Date.now() } });
            yield sse({ event: "snapshot", data: { timestamp: Date.now() } });

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
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({
          workflow: t.Optional(
            t.Union([
              t.Literal("create"),
              t.Literal("delete"),
              t.Literal("all"),
            ])
          ),
        }),
        response: {
          200: t.Any(),
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .get(
      "/:id/services/stream",
      async ({ params, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

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
                const payload = await serializeService(deps, database, row);
                sendEvent("service", JSON.stringify(payload));
              } catch (error) {
                log.error(
                  { error, serviceId },
                  "Failed to stream service update"
                );
              }
            };

            const unsubscribe = subscribeToServiceEvents(params.id, (event) => {
              pushSnapshot(event.serviceId).catch(() => {
                /* errors already logged inside pushSnapshot */
              });
            });

            const heartbeat = setInterval(() => {
              sendEvent("heartbeat", JSON.stringify(Date.now()));
            }, SSE_HEARTBEAT_INTERVAL_MS);

            sendEvent("ready", JSON.stringify({ timestamp: Date.now() }));

            const pushAllSnapshots = async () => {
              try {
                const rows = await fetchServiceRows(database, params.id);
                for (const row of rows) {
                  const payload = await serializeService(deps, database, row);
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

            pushAllSnapshots().catch(() => {
              /* errors already logged inside pushAllSnapshots */
            });

            cleanup = () => {
              unsubscribe();
              clearInterval(heartbeat);
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
      {
        params: t.Object({ id: t.String() }),
      }
    )

    .get(
      "/:id/setup/terminal/stream",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const resolvedCell = cell;

        const session = deps.getSetupTerminalSession(resolvedCell.id);
        const setupState = deriveSetupTerminalState(resolvedCell, session);
        const initialOutput = deps.readSetupTerminalOutput(resolvedCell.id);
        const { iterator, cleanup } =
          createAsyncEventIterator<ServiceTerminalEvent>(
            (listener) =>
              deps.subscribeToSetupTerminal(resolvedCell.id, listener),
            request.signal
          );

        async function* stream() {
          try {
            yield sse({
              event: "ready",
              data: {
                session,
                setupState,
                lastSetupError: resolvedCell.lastSetupError,
              },
            });

            if (initialOutput.length > 0) {
              yield sse({
                event: "snapshot",
                data: { output: initialOutput },
              });
            }

            for await (const event of iterator) {
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
            cleanup();
          }
        }

        return stream();
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Any(),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/setup/terminal/resize",
      async ({ params, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          deps.resizeSetupTerminal(cell.id, body.cols, body.rows);
          const session = deps.getSetupTerminalSession(cell.id);
          if (!session) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message: "Setup terminal session not available",
            } satisfies { message: string };
          }
          return {
            ok: true,
            session,
          };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to resize setup terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to resize setup terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: CellTerminalResizeSchema,
        response: {
          200: RuntimeTerminalResizeResponseSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/setup/terminal/input",
      async ({ params, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const session = deps.getSetupTerminalSession(cell.id);
        if (!session || session.status !== "running") {
          set.status = HTTP_STATUS.CONFLICT;
          return {
            message: "Setup terminal session not available",
          } satisfies { message: string };
        }

        try {
          deps.writeSetupTerminalInput(cell.id, body.data);
          return { ok: true };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to write to setup terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to write to setup terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: CellTerminalInputSchema,
        response: {
          200: CellTerminalActionResponseSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
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

        async function* stream() {
          try {
            yield sse({ event: "ready", data: { session } });

            if (initialOutput.length > 0) {
              yield sse({ event: "snapshot", data: { output: initialOutput } });
            }

            for await (const event of iterator) {
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
            cleanup();
          }
        }

        return stream();
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: t.Any(),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/:serviceId/terminal/input",
      async ({ params, body, set, log }) => {
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
        if (!session || session.status !== "running") {
          set.status = HTTP_STATUS.CONFLICT;
          return {
            message: "Service terminal session not available",
          } satisfies { message: string };
        }

        try {
          deps.writeServiceTerminalInput(row.service.id, body.data);
          return { ok: true };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, serviceId: row.service.id },
            "Failed to write to service terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to write to service terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        body: CellTerminalInputSchema,
        response: {
          200: CellTerminalActionResponseSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/:serviceId/terminal/resize",
      async ({ params, body, set, log }) => {
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

        try {
          deps.resizeServiceTerminal(row.service.id, body.cols, body.rows);
          const session = deps.getServiceTerminalSession(row.service.id);
          if (!session) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message: "Service terminal session not available",
            } satisfies { message: string };
          }

          return {
            ok: true,
            session,
          };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, serviceId: row.service.id },
            "Failed to resize service terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to resize service terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        body: CellTerminalResizeSchema,
        response: {
          200: RuntimeTerminalResizeResponseSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
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

        async function* stream() {
          try {
            yield sse({ event: "ready", data: session });

            if (initialOutput.length > 0) {
              yield sse({
                event: "snapshot",
                data: { output: initialOutput },
              });
            }

            for await (const event of iterator) {
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
            cleanup();
          }
        }

        return stream();
      },
      {
        params: t.Object({ id: t.String() }),
        query: ChatThemeModeQuerySchema,
        response: {
          200: t.Any(),
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/chat/terminal/input",
      async ({ params, query, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          if (!isCellReadyForChat(cell)) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message:
                "Chat terminal is unavailable until provisioning completes",
            } satisfies { message: string };
          }

          const themeMode = normalizeOpencodeThemeMode(query.themeMode);
          const { chatTerminal } = await ensureChatTerminalSessionForCell(
            deps,
            cell,
            themeMode
          );
          chatTerminal.writeChatTerminalInput(cell.id, body.data);
          return { ok: true };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to write to chat terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to write to chat terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        query: ChatThemeModeQuerySchema,
        body: CellTerminalInputSchema,
        response: {
          200: CellTerminalActionResponseSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/chat/terminal/resize",
      async ({ params, query, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          if (!isCellReadyForChat(cell)) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message:
                "Chat terminal is unavailable until provisioning completes",
            } satisfies { message: string };
          }

          const themeMode = normalizeOpencodeThemeMode(query.themeMode);
          const { session, chatTerminal } =
            await ensureChatTerminalSessionForCell(deps, cell, themeMode);
          chatTerminal.resizeChatTerminal(cell.id, body.cols, body.rows);
          return {
            ok: true,
            session: {
              ...session,
              cols: body.cols,
              rows: body.rows,
            },
          };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to resize chat terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to resize chat terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        query: ChatThemeModeQuerySchema,
        body: CellTerminalResizeSchema,
        response: {
          200: t.Object({
            ok: t.Boolean(),
            session: CellTerminalSessionSchema,
          }),
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/chat/terminal/restart",
      async ({ params, query, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          if (!isCellReadyForChat(cell)) {
            set.status = HTTP_STATUS.CONFLICT;
            return {
              message:
                "Chat terminal is unavailable until provisioning completes",
            } satisfies { message: string };
          }

          const chatTerminal = getChatTerminalDependencies(deps);
          chatTerminal.closeChatTerminalSession(cell.id);
          const themeMode = normalizeOpencodeThemeMode(query.themeMode);
          const { session } = await ensureChatTerminalSessionForCell(
            deps,
            cell,
            themeMode
          );
          return session;
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to restart chat terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to restart chat terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        query: ChatThemeModeQuerySchema,
        response: {
          200: CellTerminalSessionSchema,
          404: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .get(
      "/:id/terminal/stream",
      async ({ params, set, request, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        let session: CellTerminalSession;
        try {
          session = deps.ensureTerminalSession({
            cellId: cell.id,
            workspacePath: cell.workspacePath,
          });
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to initialize cell terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to initialize terminal session",
          } satisfies { message: string };
        }

        const initialOutput = deps.readTerminalOutput(cell.id);
        const { iterator, cleanup } =
          createAsyncEventIterator<CellTerminalEvent>(
            (listener) => deps.subscribeToTerminal(cell.id, listener),
            request.signal
          );

        async function* stream() {
          try {
            yield sse({ event: "ready", data: session });

            if (initialOutput.length > 0) {
              yield sse({
                event: "snapshot",
                data: { output: initialOutput },
              });
            }

            for await (const event of iterator) {
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
            cleanup();
          }
        }

        return stream();
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: t.Any(),
          404: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/terminal/input",
      async ({ params, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          deps.ensureTerminalSession({
            cellId: cell.id,
            workspacePath: cell.workspacePath,
          });
          deps.writeTerminalInput(cell.id, body.data);
          return { ok: true };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to write to terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to write to terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: CellTerminalInputSchema,
        response: {
          200: CellTerminalActionResponseSchema,
          404: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/terminal/resize",
      async ({ params, body, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          const session = deps.ensureTerminalSession({
            cellId: cell.id,
            workspacePath: cell.workspacePath,
          });
          deps.resizeTerminal(cell.id, body.cols, body.rows);
          return {
            ok: true,
            session: {
              ...session,
              cols: body.cols,
              rows: body.rows,
            },
          };
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to resize terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to resize terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: CellTerminalResizeSchema,
        response: {
          200: t.Object({
            ok: t.Boolean(),
            session: CellTerminalSessionSchema,
          }),
          404: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/terminal/restart",
      async ({ params, set, log }) => {
        const deps = await resolveDeps();
        const { db: database } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        try {
          deps.closeTerminalSession(cell.id);
          const session = deps.ensureTerminalSession({
            cellId: cell.id,
            workspacePath: cell.workspacePath,
          });
          return session;
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          log.error(
            { error, cellId: cell.id },
            "Failed to restart terminal session"
          );
          return {
            message:
              error instanceof Error
                ? error.message
                : "Failed to restart terminal session",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellTerminalSessionSchema,
          404: t.Object({ message: t.String() }),
          500: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/start",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database, startServicesForCell } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          type: "services.start",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {},
        });

        await startServicesForCell(params.id);
        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(deps, database, row))
        );

        return { services } satisfies CellServiceListResponse;
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellServiceListResponseSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/stop",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database, stopServicesForCell } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          type: "services.stop",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {},
        });

        await stopServicesForCell(params.id);
        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(deps, database, row))
        );

        return { services } satisfies CellServiceListResponse;
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellServiceListResponseSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .get(
      "/:id/diff",
      async ({ params, query, set }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

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
              error instanceof Error ? error.message : "Failed to compute diff",
          } satisfies { message: string };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        query: DiffQuerySchema,
        response: {
          200: CellDiffResponseSchema,
          400: t.Object({ message: t.String() }),
          409: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/:serviceId/start",

      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database, startServiceById: startService } = deps;

        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies {
            message: string;
          };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          serviceId: params.serviceId,
          type: "service.start",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {},
        });

        await startService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies {
            message: string;
          };
        }

        const serialized = await serializeService(deps, database, updated);
        return serialized satisfies CellServiceResponse;
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: CellServiceSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/:id/services/:serviceId/stop",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const { db: database, stopServiceById: stopService } = deps;

        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies {
            message: string;
          };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          serviceId: params.serviceId,
          type: "service.stop",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {},
        });

        await stopService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies {
            message: string;
          };
        }

        const serialized = await serializeService(deps, database, updated);
        return serialized satisfies CellServiceResponse;
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: CellServiceSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/restart",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const {
          db: database,
          startServicesForCell,
          stopServicesForCell,
        } = deps;
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          type: "services.restart",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {},
        });

        await stopServicesForCell(params.id);
        await startServicesForCell(params.id);

        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(deps, database, row))
        );
        return { services } satisfies CellServiceListResponse;
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellServiceListResponseSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
      }
    )

    .post(
      "/:id/services/:serviceId/restart",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const {
          db: database,
          startServiceById: startService,
          stopServiceById: stopService,
        } = deps;

        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies { message: string };
        }

        const audit = readHiveAuditHeaders(request);
        await insertCellActivityEvent({
          database,
          cellId: params.id,
          serviceId: params.serviceId,
          type: "service.restart",
          source: audit.source,
          toolName: audit.toolName,
          metadata: {
            serviceName: row.service.name,
          },
        });

        await stopService(params.serviceId);
        await startService(params.serviceId);

        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" } satisfies { message: string };
        }

        const serialized = await serializeService(deps, database, updated);
        return serialized satisfies CellServiceResponse;
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: CellServiceSchema,
          400: t.Object({ message: t.String() }),
          404: t.Object({ message: t.String() }),
        },
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
          } = deps;

          const workspaceContext = await getWorkspaceContext(body.workspaceId);
          const result = await handleCellCreationRequest({
            body,
            database,
            ensureSession,
            sendAgentMessage: sendMessage,
            ensureServices,
            stopCellServices: stopCellServicesFn,
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
      async ({ body, set, log }) => {
        try {
          const deps = await resolveDeps();
          const {
            db: database,
            resolveWorkspaceContext: resolveWorkspaceCtx,
            closeAgentSession: closeSession,
            stopServicesForCell: stopCellServicesFn,
            closeTerminalSession,
            closeChatTerminalSession,
            clearSetupTerminal,
          } = deps;

          const uniqueIds = [...new Set(body.ids)];

          const cellsToDelete = await database
            .select({
              id: cells.id,
              name: cells.name,
              templateId: cells.templateId,
              workspacePath: cells.workspacePath,
              workspaceId: cells.workspaceId,
              status: cells.status,
            })
            .from(cells)
            .where(inArray(cells.id, uniqueIds));

          if (cellsToDelete.length === 0) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "No cells found for provided ids" };
          }

          const fetchManager =
            createWorktreeManagerFetcher(resolveWorkspaceCtx);

          const deletedIds: string[] = [];

          for (const cell of cellsToDelete) {
            try {
              await deleteCellWithLifecycle({
                database,
                cell,
                closeSession,
                closeTerminalSession,
                closeChatTerminalSession,
                clearSetupTerminal,
                stopCellServices: stopCellServicesFn,
                getWorktreeService: fetchManager,
                log,
                recordTimingEvent: insertCellTimingEvent,
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
          400: t.Object({
            message: t.String(),
          }),
          404: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
        },
      }
    )
    .delete(
      "/:id",
      async ({ params, set, log }) => {
        try {
          const deps = await resolveDeps();
          const {
            db: database,
            resolveWorkspaceContext: resolveWorkspaceCtx,
            closeAgentSession: closeSession,
            stopServicesForCell: stopCellServicesFn,
            closeTerminalSession,
            closeChatTerminalSession,
            clearSetupTerminal,
          } = deps;

          const cell = await loadCellById(database, params.id);
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          const workspaceManager = await resolveWorkspaceContextFromDeps(
            resolveWorkspaceCtx,
            cell.workspaceId
          );
          const worktreeService = toAsyncWorktreeManager(
            await workspaceManager.createWorktreeManager()
          );

          await deleteCellWithLifecycle({
            database,
            cell,
            closeSession,
            closeTerminalSession,
            closeChatTerminalSession,
            clearSetupTerminal,
            stopCellServices: stopCellServicesFn,
            getWorktreeService: async () => worktreeService,
            log,
            recordTimingEvent: insertCellTimingEvent,
          });

          return { message: "Cell deleted successfully" };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete cell");
          } else {
            log.error({ error }, "Failed to delete cell");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete cell" };
        }
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        response: {
          200: t.Object({
            message: t.String(),
          }),
          404: t.Object({
            message: t.String(),
          }),
          500: ErrorResponseSchema,
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

type CellCreationArgs = {
  body: Static<typeof CreateCellSchema>;
  database: DatabaseClient;
  ensureSession: CellRouteDependencies["ensureAgentSession"];
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  ensureServices: CellRouteDependencies["ensureServicesForCell"];
  stopCellServices: CellRouteDependencies["stopServicesForCell"];
  workspaceContext: WorkspaceRuntimeContext;
  log: LoggerLike;
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
    workspaceContext,
    log,
  } = args;

  const hiveConfig = await workspaceContext.loadConfig();
  const defaultStartMode = await resolveDefaultStartMode({
    workspaceRootPath: workspaceContext.workspace.path,
    defaultsStartMode: hiveConfig.defaults?.startMode,
    configDefaultMode: hiveConfig.opencode?.defaultMode,
  });
  const body: Static<typeof CreateCellSchema> = {
    ...rawBody,
    startMode: normalizeStartMode(rawBody.startMode) ?? defaultStartMode,
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
    worktreeService,
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

type ProvisionContext = {
  body: Static<typeof CreateCellSchema>;
  template: Template;
  database: DatabaseClient;
  ensureSession: CellRouteDependencies["ensureAgentSession"];
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  ensureServices: CellRouteDependencies["ensureServicesForCell"];
  stopCellServices: CellRouteDependencies["stopServicesForCell"];
  worktreeService: AsyncWorktreeManager;
  workspace: WorkspaceRecord;
  log: LoggerLike;
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

function createProvisionContext(args: {
  body: Static<typeof CreateCellSchema>;
  template: Template;
  database: DatabaseClient;
  ensureSession: CellRouteDependencies["ensureAgentSession"];
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  ensureServices: CellRouteDependencies["ensureServicesForCell"];
  stopCellServices: CellRouteDependencies["stopServicesForCell"];
  worktreeService: AsyncWorktreeManager;
  workspace: WorkspaceRecord;
  log: LoggerLike;
}): ProvisionContext {
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

async function createExistingProvisionContext(args: {
  cell: typeof cells.$inferSelect;
  provisioningState: CellProvisioningState | null;
  body: Static<typeof CreateCellSchema>;
  template: Template;
  database: DatabaseClient;
  ensureSession: CellRouteDependencies["ensureAgentSession"];
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  ensureServices: CellRouteDependencies["ensureServicesForCell"];
  stopCellServices: CellRouteDependencies["stopServicesForCell"];
  workspaceContext: WorkspaceRuntimeContext;
  log: LoggerLike;
}) {
  const worktreeService = toAsyncWorktreeManager(
    await args.workspaceContext.createWorktreeManager()
  );

  return {
    body: args.body,
    template: args.template,
    database: args.database,
    ensureSession: args.ensureSession,
    sendAgentMessage: args.sendAgentMessage,
    ensureServices: args.ensureServices,
    stopCellServices: args.stopCellServices,
    worktreeService,
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
      startMode: body.startMode ?? "plan",
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
  const { body, database, worktreeService, state } = context;

  if (state.worktreeCreated && state.workspacePath && state.baseCommit) {
    return;
  }

  let worktree: { path: string; branch: string; baseCommit: string };
  try {
    worktree = await worktreeService.createWorktree(state.cellId, {
      templateId: body.templateId,
      force: true,
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

  return;
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
  database: DatabaseClient;
  template: Template;
  body: Static<typeof CreateCellSchema>;
}) {
  const { context, runPhase, attempt, database, template, body } = args;
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
      insertCellTimingEvent({
        database,
        log: context.log,
        cellId: state.cellId,
        cellName: state.createdCell?.name ?? body.name,
        workflow: "create",
        runId: state.timingRunId,
        step: `create_worktree:${event.step}`,
        status: "ok",
        durationMs: event.durationMs,
        attempt,
        templateId: template.id,
        workspaceId: context.workspace.id,
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
    const settledWrites = await Promise.allSettled(worktreeTimingWrites);
    for (const write of settledWrites) {
      if (write.status === "rejected") {
        context.log.warn(
          { error: write.reason, cellId: state.cellId },
          "Failed to persist create_worktree timing sub-step"
        );
      }
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

      await insertCellTimingEvent({
        database,
        log: context.log,
        cellId: state.cellId,
        cellName: state.createdCell?.name ?? body.name,
        workflow: "create",
        runId: state.timingRunId,
        step: phase,
        status: phaseStatus,
        durationMs,
        attempt,
        error: phaseError,
        templateId: template.id,
        workspaceId: context.workspace.id,
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
    database,
    template,
    body,
  });

  if (!state.createdCell) {
    throw new Error("Cell record missing after worktree provisioning");
  }
  const createdCell: NonNullable<CellProvisionState["createdCell"]> =
    state.createdCell;

  const ensureServicesTimingEvents: Array<
    EnsureCellServicesTimingEvent & { capturedAt: Date }
  > = [];

  try {
    await runPhase("ensure_services", async () =>
      ensureServices({
        cell: createdCell,
        template,
        onTimingEvent: (event) => {
          ensureServicesTimingEvents.push({
            ...event,
            capturedAt: new Date(),
          });
        },
      })
    );
  } finally {
    for (const event of ensureServicesTimingEvents) {
      await insertCellTimingEvent({
        database,
        log: context.log,
        cellId: state.cellId,
        cellName: state.createdCell?.name ?? body.name,
        workflow: "create",
        runId: state.timingRunId,
        step: `ensure_services:${event.step}`,
        status: event.status,
        durationMs: event.durationMs,
        attempt,
        error: event.error ?? null,
        templateId: template.id,
        workspaceId: context.workspace.id,
        extraMetadata: event.metadata,
        createdAt: event.capturedAt,
      });
    }
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

  const initialPrompt = body.description?.trim();
  const shouldSendInitialPrompt = shouldSendInitialPromptForAttempt({
    attempt,
    initialPrompt,
    existingSessionId,
  });
  if (shouldSendInitialPrompt && initialPrompt) {
    await runPhase("send_initial_prompt", () => {
      dispatchInitialPromptInBackground({
        sendAgentMessage: dispatchAgentMessage,
        sessionId: session.id,
        content: initialPrompt,
        timeoutMs: INITIAL_PROMPT_BACKGROUND_WARN_TIMEOUT_MS,
        cellId: state.cellId,
        log: context.log,
      });
      return Promise.resolve();
    });
  }

  const finishedAt = await runPhase("mark_ready", async () =>
    updateCellProvisioningStatus(database, state.cellId, "ready")
  );

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

  await insertCellTimingEvent({
    database,
    log: context.log,
    cellId: state.cellId,
    cellName: state.createdCell?.name ?? body.name,
    workflow: "create",
    runId: state.timingRunId,
    step: "total",
    status: "ok",
    durationMs: Date.now() - provisioningStartedAt,
    attempt,
    templateId: template.id,
    workspaceId: context.workspace.id,
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

  await stopServicesIfStarted(context);

  const finishedAt = await updateCellProvisioningStatus(
    context.database,
    context.state.cellId,
    "error",
    lastSetupError
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

  await insertCellTimingEvent({
    database: context.database,
    log: context.log,
    cellId: context.state.cellId,
    cellName: context.state.createdCell?.name ?? context.body.name,
    workflow: "create",
    runId: context.state.timingRunId,
    step: "create_request_failure",
    status: "error",
    durationMs: 0,
    error: payload.message,
    attempt: context.state.provisioningState?.attemptCount ?? null,
    templateId: context.template.id,
    workspaceId: context.workspace.id,
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
      lastSetupError
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
  await stopServicesIfStarted(context);

  if (!options.preserveWorktree) {
    await removeWorktreeIfCreated(context);
  }

  if (!options.preserveRecord) {
    await deleteCellRecordIfCreated(context);
  }
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

async function stopServicesIfStarted(context: ProvisionContext) {
  if (!context.state.servicesStarted) {
    return;
  }

  try {
    await context.stopCellServices(context.state.cellId, {
      releasePorts: true,
    });
  } catch (cleanupError) {
    context.log.warn(
      { cleanupError },
      "Failed to stop services during cell creation cleanup"
    );
  } finally {
    context.state.servicesStarted = false;
  }
}

async function removeWorktreeIfCreated(context: ProvisionContext) {
  if (!(context.state.worktreeCreated && context.state.workspacePath)) {
    return;
  }

  await removeCellWorkspace(
    context.worktreeService,
    {
      id: context.state.cellId,
      workspacePath: context.state.workspacePath,
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

function resolveProvisioningParams(
  cell: typeof cells.$inferSelect,
  provisioningState?: CellProvisioningState | null
): Static<typeof CreateCellSchema> {
  return {
    name: cell.name,
    ...(cell.description != null ? { description: cell.description } : {}),
    templateId: cell.templateId,
    workspaceId: cell.workspaceId,
    ...(provisioningState?.modelIdOverride != null
      ? { modelId: provisioningState.modelIdOverride }
      : {}),
    ...(provisioningState?.providerIdOverride != null
      ? { providerId: provisioningState.providerIdOverride }
      : {}),
    ...(provisioningState?.startMode != null
      ? { startMode: normalizeStartMode(provisioningState.startMode) }
      : {}),
  };
}

function shouldSendInitialPromptForAttempt(args: {
  attempt: number | null;
  initialPrompt?: string;
  existingSessionId: string | null;
}): boolean {
  if (!args.initialPrompt) {
    return false;
  }

  if (args.attempt === 1) {
    return true;
  }

  return !args.existingSessionId;
}

function buildAgentSessionOptions(body: Static<typeof CreateCellSchema>) {
  return {
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.providerId ? { providerId: body.providerId } : {}),
    ...(body.startMode ? { startMode: body.startMode } : {}),
  };
}

function dispatchInitialPromptInBackground(args: {
  sendAgentMessage: CellRouteDependencies["sendAgentMessage"];
  sessionId: string;
  content: string;
  timeoutMs: number;
  cellId: string;
  log: LoggerLike;
}): void {
  const promptStartedAt = Date.now();
  const promptDispatch = args.sendAgentMessage(args.sessionId, args.content);
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
  info?: (obj: Record<string, unknown>, message?: string) => void;
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
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
      await updateCellProvisioningStatus(
        deps.db,
        cell.id,
        "error",
        `${PROVISIONING_INTERRUPTED_MESSAGE}\nRetry limit exceeded.`
      );
      return;
    }

    const workspaceContext = await resolveWorkspaceContextFromDeps(
      deps.resolveWorkspaceContext,
      cell.workspaceId
    );
    const hiveConfig = await workspaceContext.loadConfig();

    const template = hiveConfig.templates[cell.templateId];
    if (!template) {
      await updateCellProvisioningStatus(
        deps.db,
        cell.id,
        "error",
        `${PROVISIONING_INTERRUPTED_MESSAGE}\nTemplate ${cell.templateId} no longer exists.`
      );
      return;
    }

    const context = await createExistingProvisionContext({
      cell,
      provisioningState,
      body: resolveProvisioningParams(cell, provisioningState),
      template,
      database: deps.db,
      ensureSession: deps.ensureAgentSession,
      sendAgentMessage: deps.sendAgentMessage,
      ensureServices: deps.ensureServicesForCell,
      stopCellServices: deps.stopServicesForCell,
      workspaceContext,
      log: backgroundProvisioningLogger,
    });

    startProvisioningWorkflow(context);
  } catch (error) {
    await updateCellProvisioningStatus(
      deps.db,
      cell.id,
      "error",
      `${PROVISIONING_INTERRUPTED_MESSAGE}\n${
        error instanceof Error ? error.message : String(error)
      }`
    );
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
    .select({
      id: cells.id,
      name: cells.name,
      templateId: cells.templateId,
      workspacePath: cells.workspacePath,
      workspaceId: cells.workspaceId,
      status: cells.status,
    })
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
        database: deps.db,
        cell,
        closeSession: deps.closeAgentSession,
        closeTerminalSession: deps.closeTerminalSession,
        closeChatTerminalSession: deps.closeChatTerminalSession,
        clearSetupTerminal: deps.clearSetupTerminal,
        stopCellServices: deps.stopServicesForCell,
        getWorktreeService: fetchManager,
        log: backgroundProvisioningLogger,
        recordTimingEvent: insertCellTimingEvent,
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

const reviveTemplateSetupError = (
  error: unknown
): TemplateSetupError | null => {
  if (error instanceof TemplateSetupError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "TemplateSetupError" &&
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

const reviveCommandExecutionError = (
  error: unknown
): CommandExecutionError | null => {
  if (error instanceof CommandExecutionError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "CommandExecutionError" &&
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
  lastSetupError?: string | null
): Promise<Date | null> {
  const finished = status === "ready" || status === "error";
  const finishedAt = finished ? new Date() : null;
  await database
    .update(cells)
    .set({ status, lastSetupError: lastSetupError ?? null })
    .where(eq(cells.id, cellId));

  if (finishedAt) {
    await database
      .update(cellProvisioningStates)
      .set({ finishedAt })
      .where(eq(cellProvisioningStates.cellId, cellId));
  }

  const cell = await database.query.cells.findFirst({
    where: eq(cells.id, cellId),
    columns: { workspaceId: true },
  });

  if (cell) {
    emitCellStatusUpdate({
      workspaceId: cell.workspaceId,
      cellId,
      status,
      lastSetupError,
    });
  }

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

async function loadCellById(
  database: DatabaseClient,
  cellId: string
): Promise<typeof cells.$inferSelect | null> {
  const [cell] = await database
    .select()
    .from(cells)
    .where(eq(cells.id, cellId))
    .limit(1);

  return cell ?? null;
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: normalizes persisted service state against runtime process state.
async function serializeService(
  deps: CellRouteDependencies,
  database: DatabaseClient,
  row: ServiceRow,
  logOptions?: LogTailOptions
) {
  const { service } = row;
  const output = deps.readServiceTerminalOutput(service.id);
  const logResult = readOutputTail(
    output.length > 0 ? output : null,
    logOptions
  );
  const runtimeSession = deps.getServiceTerminalSession(service.id);
  const processAlive =
    runtimeSession?.status === "running" || isProcessAlive(service.pid);
  const portReachable =
    typeof service.port === "number"
      ? await isPortActive(service.port)
      : undefined;
  const serviceUrl = buildServiceUrl(service.port);

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
    ...(service.port != null ? { port: service.port } : {}),
    ...(serviceUrl ? { url: serviceUrl } : {}),
    ...(derivedPid != null ? { pid: derivedPid } : {}),
    command: service.command,
    cwd: service.cwd,
    logPath: null,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs: logResult.content,
    totalLogLines: logResult.totalLines,
    hasMoreLogs: logResult.hasMore,
    processAlive,
    ...(portReachable !== undefined ? { portReachable } : {}),
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
