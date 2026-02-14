import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createConnection } from "node:net";

import { logger } from "@bogeychan/elysia-logger";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { Elysia, type Static, sse, t } from "elysia";
import { getSharedOpencodeServerBaseUrl } from "../agents/opencode-server";
import type { AgentRuntimeService } from "../agents/service";
import { agentRuntimeService } from "../agents/service";
import type { Template } from "../config/schema";
import {
  DatabaseService,
  type DatabaseService as DatabaseServiceType,
} from "../db";
import {
  ACTIVITY_EVENT_TYPES,
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
import { createAsyncEventIterator } from "../services/async-iterator";
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
  emitCellStatusUpdate,
  subscribeToCellStatusEvents,
  subscribeToServiceEvents,
} from "../services/events";
import type {
  ServiceTerminalEvent,
  ServiceTerminalSession,
} from "../services/service-terminal";
import type {
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
import type { WorkspaceRecord } from "../workspaces/registry";
import {
  type AsyncWorktreeManager,
  describeWorktreeError,
  toAsyncWorktreeManager,
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
  }) => ChatTerminalSession;
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

const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_ACTIVITY_LIMIT = 200;

function encodeActivityCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}:${id}`;
}

function parseActivityCursor(cursor: string): { createdAt: Date; id: string } {
  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error("Invalid cursor");
  }

  const millis = Number(cursor.slice(0, separatorIndex));
  const id = cursor.slice(separatorIndex + 1);
  if (!(Number.isFinite(millis) && id.length)) {
    throw new Error("Invalid cursor");
  }

  return { createdAt: new Date(millis), id };
}

function normalizeActivityLimit(limit?: number): number {
  const fallback = DEFAULT_ACTIVITY_LIMIT;
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ACTIVITY_LIMIT);
}

function normalizeActivityTypes(types?: string): ActivityEventType[] | null {
  if (!types) {
    return null;
  }
  const allowed = new Set<string>(ACTIVITY_EVENT_TYPES);
  const filtered = types
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.has(value));
  return filtered.length ? (filtered as ActivityEventType[]) : null;
}

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
const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
type OpencodeThemeMode = "dark" | "light";
const ChatThemeModeQuerySchema = t.Object({
  themeMode: t.Optional(t.Union([t.Literal("dark"), t.Literal("light")])),
});

const PROVISIONING_INTERRUPTED_MESSAGE =
  "Provisioning interrupted. Fix the workspace and rerun setup.";

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

  const agentSession = await deps.ensureAgentSession(cell.id);
  const chatTerminal = getChatTerminalDependencies(deps);
  const session = chatTerminal.ensureChatTerminalSession({
    cellId: cell.id,
    workspacePath: cell.workspacePath,
    opencodeSessionId: agentSession.id,
    opencodeServerUrl: serverUrl,
    opencodeThemeMode: themeMode,
  });

  return {
    session,
    chatTerminal,
  };
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
    .use(logger(LOGGER_CONFIG))
    .use(workspaceContextPlugin)
    .post(
      "/:id/setup/retry",
      async ({ params, set, request }) => {
        const deps = await resolveDeps();
        const cell = await loadCellById(deps.db, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }

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
          await deps.db
            .update(cells)
            .set({ status: "pending", lastSetupError: null })
            .where(eq(cells.id, cell.id));

          emitCellStatusUpdate({
            workspaceId: cell.workspaceId,
            cellId: cell.id,
            status: "pending",
            lastSetupError: null,
          });

          await deps.ensureServicesForCell({
            cell: {
              ...cell,
              status: "pending",
              lastSetupError: null,
            },
            template,
          });

          await deps.db
            .update(cells)
            .set({ status: "ready", lastSetupError: null })
            .where(eq(cells.id, cell.id));

          emitCellStatusUpdate({
            workspaceId: cell.workspaceId,
            cellId: cell.id,
            status: "ready",
            lastSetupError: null,
          });
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
            .where(eq(cells.workspaceId, workspaceContext.workspace.id));
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
              .where(eq(cells.workspaceId, workspaceId));

            for (const cell of initialCells) {
              yield sse({ event: "cell", data: cellToResponse(cell) });
            }

            yield sse({ event: "snapshot", data: { timestamp: Date.now() } });

            for await (const event of iterator) {
              try {
                const cell = await loadCellById(database, event.cellId);
                if (cell) {
                  yield sse({ event: "cell", data: cellToResponse(cell) });
                }
              } catch (error) {
                log.error(
                  { error, cellId: event.cellId },
                  "Failed to stream cell update"
                );
              }
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
      async ({ params, set, request }) => {
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

        const extras = buildSetupLogPayload(cell.id, deps);
        return { ...cellToResponse(cell), ...extras };
      },
      {
        params: t.Object({
          id: t.String(),
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

        const whereClause = and(
          eq(cellActivityEvents.cellId, params.id),
          types ? inArray(cellActivityEvents.type, types) : undefined,
          cursor
            ? or(
                lt(cellActivityEvents.createdAt, cursor.createdAt),
                and(
                  eq(cellActivityEvents.createdAt, cursor.createdAt),
                  lt(cellActivityEvents.id, cursor.id)
                )
              )
            : undefined
        );

        const rows = await database
          .select()
          .from(cellActivityEvents)
          .where(whereClause)
          .orderBy(
            desc(cellActivityEvents.createdAt),
            desc(cellActivityEvents.id)
          )
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const slice = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore
          ? (() => {
              const last = slice.at(-1);
              if (!last) {
                return null;
              }
              return encodeActivityCursor(last.createdAt, last.id);
            })()
          : null;

        return {
          events: slice.map((event) => ({
            id: event.id,
            cellId: event.cellId,
            serviceId: event.serviceId ?? null,
            type: event.type,
            source: event.source ?? null,
            toolName: event.toolName ?? null,
            metadata: event.metadata,
            createdAt: event.createdAt.toISOString(),
          })),
          nextCursor,
        } satisfies CellActivityEventListResponse;
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

          const managerCache = new Map<string, AsyncWorktreeManager>();
          const fetchManager = async (workspaceId: string) => {
            const cached = managerCache.get(workspaceId);
            if (cached) {
              return cached;
            }
            const context = await resolveWorkspaceContextFromDeps(
              resolveWorkspaceCtx,
              workspaceId
            );
            const manager = toAsyncWorktreeManager(
              await context.createWorktreeManager()
            );
            managerCache.set(workspaceId, manager);
            return manager;
          };

          for (const cell of cellsToDelete) {
            await closeSession(cell.id);
            closeTerminalSession(cell.id);
            closeChatTerminalSession?.(cell.id);
            clearSetupTerminal(cell.id);
            try {
              await stopCellServicesFn(cell.id, {
                releasePorts: true,
              });
            } catch (error) {
              log.warn(
                { error, cellId: cell.id },
                "Failed to stop services before cell removal"
              );
            }

            const worktreeService = await fetchManager(cell.workspaceId);
            await removeCellWorkspace(worktreeService, cell, log);
          }

          const idsToDelete = cellsToDelete.map((cell) => cell.id);

          await database.delete(cells).where(inArray(cells.id, idsToDelete));

          return { deletedIds: idsToDelete };
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

          await closeSession(params.id);
          closeTerminalSession(params.id);
          closeChatTerminalSession?.(params.id);
          clearSetupTerminal(params.id);
          try {
            await stopCellServicesFn(params.id, { releasePorts: true });
          } catch (error) {
            log.warn(
              { error, cellId: params.id },
              "Failed to stop services before cell removal"
            );
          }

          const workspaceManager = await resolveWorkspaceContextFromDeps(
            resolveWorkspaceCtx,
            cell.workspaceId
          );
          const worktreeService = toAsyncWorktreeManager(
            await workspaceManager.createWorktreeManager()
          );
          await removeCellWorkspace(worktreeService, cell, log);

          await database.delete(cells).where(eq(cells.id, params.id));

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
    body,
    database,
    ensureSession,
    sendAgentMessage: dispatchAgentMessage,
    ensureServices,
    stopCellServices,
    workspaceContext,
    log,
  } = args;

  const hiveConfig = await workspaceContext.loadConfig();
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

  try {
    const cell = await createCellRecord(context);
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
  workspacePath: string | null;
  branchName: string | null;
  baseCommit: string | null;
  createdCell: typeof cells.$inferSelect | null;
  provisioningState: CellProvisioningState | null;
};

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
      worktreeCreated: true,
      recordCreated: true,
      servicesStarted: false,
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
): Promise<typeof cells.$inferSelect> {
  const { body, database, worktreeService, workspace, state } = context;

  let worktree: { path: string; branch: string; baseCommit: string };
  try {
    worktree = await worktreeService.createWorktree(state.cellId, {
      templateId: body.templateId,
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

  const timestamp = new Date();
  const newCell: NewCell = {
    id: state.cellId,
    name: body.name,
    description: body.description ?? null,
    templateId: body.templateId,
    workspacePath: worktree.path,
    workspaceId: workspace.id,
    workspaceRootPath: workspace.path,
    branchName: worktree.branch,
    baseCommit: worktree.baseCommit,
    opencodeSessionId: null,
    createdAt: timestamp,
    status: "spawning",
    lastSetupError: null,
  };

  const [created] = await database.insert(cells).values(newCell).returning();

  if (!created) {
    throw new Error("Failed to create cell record");
  }

  state.recordCreated = true;
  state.createdCell = created;

  const [provisioningState] = await database
    .insert(cellProvisioningStates)
    .values({
      cellId: state.cellId,
      modelIdOverride: body.modelId ?? null,
      providerIdOverride: body.providerId ?? null,
      startedAt: null,
      finishedAt: null,
      attemptCount: 0,
    })
    .returning();

  state.provisioningState = provisioningState ?? null;

  return created;
}

function startProvisioningWorkflow(context: ProvisionContext) {
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
    });
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

  await ensureServices({
    cell: state.createdCell,
    template,
  });

  state.servicesStarted = true;

  const sessionOptions = {
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.providerId ? { providerId: body.providerId } : {}),
  };
  const session = await ensureSession(
    state.cellId,
    Object.keys(sessionOptions).length ? sessionOptions : undefined
  );

  const initialPrompt = body.description?.trim();
  if (initialPrompt) {
    await dispatchAgentMessage(session.id, initialPrompt);
  }

  const finishedAt = await updateCellProvisioningStatus(
    database,
    state.cellId,
    "ready"
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
}

async function handleDeferredProvisionFailure(
  context: ProvisionContext,
  error: unknown
): Promise<void> {
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
  };
}

type CellWorkspaceRecord = Pick<
  typeof cells.$inferSelect,
  "id" | "workspacePath"
>;

type LoggerLike = {
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
};

const backgroundProvisioningLogger: LoggerLike = {
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

const resumePendingCells = async (
  overrides: Partial<CellRouteDependencies> = {}
) => {
  const deps = await resolveCellRouteDependencies(overrides);
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

export async function resumeSpawningCells(
  overrides: Partial<CellRouteDependencies> = {}
): Promise<void> {
  await resumePendingCells(overrides);
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

async function removeCellWorkspace(
  worktreeService: AsyncWorktreeManager,
  cell: CellWorkspaceRecord,
  log: LoggerLike
) {
  try {
    await worktreeService.removeWorktree(cell.id);
    return;
  } catch (error) {
    const worktreeError = error as WorktreeManagerError;
    log.warn(
      {
        error: describeWorktreeError(worktreeError),
        cellId: cell.id,
      },
      "Failed to remove git worktree, attempting filesystem cleanup"
    );
  }

  if (!cell.workspacePath) {
    return;
  }

  try {
    await fs.rm(cell.workspacePath, { recursive: true, force: true });
  } catch (filesystemError) {
    log.warn(
      {
        error: filesystemError,
        cellId: cell.id,
        workspacePath: cell.workspacePath,
      },
      "Failed to remove cell workspace directory"
    );
  }
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
