import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createConnection } from "node:net";
import { resolve as resolvePath } from "node:path";
import { logger } from "@bogeychan/elysia-logger";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia, type Static, t } from "elysia";
import { closeAgentSession, ensureAgentSession } from "../agents/service";
import type { Template } from "../config/schema";
import { db } from "../db";

import {
  CellDiffResponseSchema,
  CellListResponseSchema,
  CellResponseSchema,
  CellServiceListResponseSchema,
  CellServiceSchema,
  CreateCellSchema,
  DeleteCellsSchema,
  DiffQuerySchema,
} from "../schema/api";
import { type CellStatus, cells, type NewCell } from "../schema/cells";
import { cellServices } from "../schema/services";
import {
  buildCellDiffPayload,
  parseDiffRequest,
} from "../services/diff-route-helpers";
import { subscribeToServiceEvents } from "../services/events";
import {
  CommandExecutionError,
  ensureServicesForCell,
  isProcessAlive,
  startServiceById,
  stopServiceById,
  stopServicesForCell,
  TemplateSetupError,
} from "../services/supervisor";
import {
  resolveWorkspaceContext,
  type WorkspaceRuntimeContext,
} from "../workspaces/context";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";
import type { WorkspaceRecord } from "../workspaces/registry";
import type { WorktreeManager } from "../worktree/manager";

export type CellRouteDependencies = {
  db: typeof db;
  resolveWorkspaceContext: typeof resolveWorkspaceContext;
  ensureAgentSession: typeof ensureAgentSession;
  closeAgentSession: typeof closeAgentSession;
  ensureServicesForCell: typeof ensureServicesForCell;
  startServiceById: typeof startServiceById;
  stopServiceById: typeof stopServiceById;
  stopServicesForCell: typeof stopServicesForCell;
};

const defaultCellRouteDependencies: CellRouteDependencies = {
  db,
  resolveWorkspaceContext,
  ensureAgentSession,
  closeAgentSession,
  ensureServicesForCell,
  startServiceById,
  stopServiceById,
  stopServicesForCell,
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

const LOG_TAIL_MAX_BYTES = 64_000;
const LOG_TAIL_MAX_LINES = 200;
const LOG_LINE_SPLIT_RE = /\r?\n/;
const SERVICE_LOG_DIR = ".hive/logs";
const PORT_CHECK_TIMEOUT_MS = 500;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
} as const;

function isPortActive(port?: number | null): Promise<boolean> {
  if (!port) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
      .once("connect", () => {
        socket.end();
        resolve(true);
      })
      .once("error", () => {
        resolve(false);
      })
      .once("timeout", () => {
        socket.destroy();
        resolve(false);
      });

    socket.setTimeout(PORT_CHECK_TIMEOUT_MS);
  });
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
    opencodeServerUrl: cell.opencodeServerUrl,
    opencodeServerPort: cell.opencodeServerPort,
    createdAt: cell.createdAt.toISOString(),
    status: cell.status,
    lastSetupError: cell.lastSetupError ?? undefined,
    branchName: cell.branchName ?? undefined,
    baseCommit: cell.baseCommit ?? undefined,
  };
}

type ErrorPayload = {
  message: string;
  details?: string;
};

export function createCellsRoutes(
  overrides: Partial<CellRouteDependencies> = {}
) {
  const deps = { ...defaultCellRouteDependencies, ...overrides };
  const {
    db: database,
    resolveWorkspaceContext: resolveWorkspaceCtx,
    ensureAgentSession: ensureSession,
    closeAgentSession: closeSession,
    ensureServicesForCell: ensureServices,
    startServiceById: startService,
    stopServiceById: stopService,
    stopServicesForCell: stopCellServicesFn,
  } = deps;

  const workspaceContextPlugin = createWorkspaceContextPlugin({
    resolveWorkspaceContext: resolveWorkspaceCtx,
  });

  return new Elysia({ prefix: "/api/cells" })
    .use(logger(LOGGER_CONFIG))
    .use(workspaceContextPlugin)
    .get(
      "/",
      async ({ query, set, getWorkspaceContext }) => {
        try {
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
      "/:id",
      async ({ params, set }) => {
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

        return cellToResponse(cell);
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
      async ({ params, set }) => {
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
        }

        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(database, row))
        );

        return { services };
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellServiceListResponseSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .get(
      "/:id/services/stream",
      async ({ params, set, log }) => {
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
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
                const payload = await serializeService(database, row);
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
                  const payload = await serializeService(database, row);
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
      "/:id/diff",
      async ({ params, query, set }) => {
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
        }

        const parsed = parseDiffRequest(cell, query);
        if (!parsed.ok) {
          set.status = parsed.status;
          return { message: parsed.message };
        }

        try {
          return await buildCellDiffPayload(cell, parsed.value);
        } catch (error) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return {
            message:
              error instanceof Error ? error.message : "Failed to compute diff",
          };
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

      async ({ params, set }) => {
        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        await startService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        return serializeService(database, updated);
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: CellServiceSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/:id/services/:serviceId/stop",
      async ({ params, set }) => {
        const row = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!row) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        await stopService(params.serviceId);
        const updated = await fetchServiceRow(
          database,
          params.id,
          params.serviceId
        );
        if (!updated) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Service not found" };
        }

        return serializeService(database, updated);
      },
      {
        params: t.Object({ id: t.String(), serviceId: t.String() }),
        response: {
          200: CellServiceSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/",
      async ({ body, set, log, getWorkspaceContext }) => {
        try {
          const workspaceContext = await getWorkspaceContext(body.workspaceId);
          const result = await handleCellCreationRequest({
            body,
            database,
            ensureSession,
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
          const uniqueIds = [...new Set(body.ids)];

          const cellsToDelete = await database
            .select({
              id: cells.id,
              workspacePath: cells.workspacePath,
              workspaceId: cells.workspaceId,
            })
            .from(cells)
            .where(inArray(cells.id, uniqueIds));

          if (cellsToDelete.length === 0) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "No cells found for provided ids" };
          }

          const managerCache = new Map<string, WorktreeManager>();
          const fetchManager = async (workspaceId: string) => {
            const cached = managerCache.get(workspaceId);
            if (cached) {
              return cached;
            }
            const context = await resolveWorkspaceCtx(workspaceId);
            const manager = await context.createWorktreeManager();
            managerCache.set(workspaceId, manager);
            return manager;
          };

          for (const cell of cellsToDelete) {
            await closeSession(cell.id);
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
          const cell = await loadCellById(database, params.id);
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          await closeSession(params.id);
          try {
            await stopCellServicesFn(params.id, { releasePorts: true });
          } catch (error) {
            log.warn(
              { error, cellId: params.id },
              "Failed to stop services before cell removal"
            );
          }

          const workspaceManager = await resolveWorkspaceCtx(cell.workspaceId);
          const worktreeService =
            await workspaceManager.createWorktreeManager();
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
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForCell;
  stopCellServices: typeof stopServicesForCell;
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

  const worktreeService = await workspaceContext.createWorktreeManager();
  const context = createProvisionContext({
    body,
    template,
    database,
    ensureSession,
    ensureServices,
    stopCellServices,
    worktreeService,
    workspace: workspaceContext.workspace,
    log,
  });

  try {
    const cell = await createCellWithServices(context);
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
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForCell;
  stopCellServices: typeof stopServicesForCell;
  worktreeService: WorktreeManager;
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
};

function createProvisionContext(args: {
  body: Static<typeof CreateCellSchema>;
  template: Template;
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForCell;
  stopCellServices: typeof stopServicesForCell;
  worktreeService: WorktreeManager;
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
    },
  };
}

async function createCellWithServices(
  context: ProvisionContext
): Promise<typeof cells.$inferSelect> {
  const {
    body,
    template,
    database,
    ensureSession,
    ensureServices,
    worktreeService,
    workspace,
    state,
  } = context;

  const worktree = await worktreeService.createWorktree(state.cellId, {
    templateId: body.templateId,
  });
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
    opencodeServerUrl: null,
    opencodeServerPort: null,
    createdAt: timestamp,
    status: "pending",
    lastSetupError: null,
  };

  const [created] = await database.insert(cells).values(newCell).returning();

  if (!created) {
    throw new Error("Failed to create cell record");
  }

  state.recordCreated = true;
  state.createdCell = created;

  await ensureSession(state.cellId);
  await ensureServices(created, template);

  state.servicesStarted = true;

  await updateCellProvisioningStatus(database, state.cellId, "ready");

  const readyRecord = { ...created, status: "ready", lastSetupError: null };
  state.createdCell = readyRecord;
  return readyRecord;
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

    await updateCellProvisioningStatus(
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
  }
}

type CellWorkspaceRecord = Pick<
  typeof cells.$inferSelect,
  "id" | "workspacePath"
>;

type LoggerLike = {
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
};

function shouldPreserveCellWorkspace(
  error: unknown
): error is TemplateSetupError {
  return error instanceof TemplateSetupError;
}

function deriveSetupErrorDetails(payload: ErrorPayload): string {
  const details = payload.details?.trim();
  return details?.length ? details : payload.message;
}

async function updateCellProvisioningStatus(
  database: typeof db,
  cellId: string,
  status: CellStatus,
  lastSetupError?: string | null
): Promise<void> {
  await database
    .update(cells)
    .set({ status, lastSetupError: lastSetupError ?? null })
    .where(eq(cells.id, cellId));
}

function buildCellCreationErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof TemplateSetupError) {
    const details = [
      `Template ID: ${error.templateId}`,
      `Workspace: ${error.workspacePath}`,
      `Command: ${error.command}`,
    ];

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
  }

  if (error instanceof CommandExecutionError) {
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
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      details: formatStackTrace(error),
    };
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
  worktreeService: WorktreeManager,
  cell: CellWorkspaceRecord,
  log: LoggerLike
) {
  try {
    worktreeService.removeWorktree(cell.id);
    return;
  } catch (error) {
    log.warn(
      { error, cellId: cell.id },
      "Failed to remove git worktree, attempting filesystem cleanup"
    );
  }

  if (!cell.workspacePath) {
    return;
  }

  try {
    await fs.rm(cell.workspacePath, { recursive: true, force: true });
  } catch (error) {
    log.warn(
      {
        error,
        cellId: cell.id,
        workspacePath: cell.workspacePath,
      },
      "Failed to remove cell workspace directory"
    );
  }
}

async function loadCellById(
  database: typeof db,
  cellId: string
): Promise<typeof cells.$inferSelect | null> {
  const [cell] = await database
    .select()
    .from(cells)
    .where(eq(cells.id, cellId))
    .limit(1);

  return cell ?? null;
}

function fetchServiceRows(database: typeof db, cellId: string) {
  return database
    .select({ service: cellServices, cell: cells })
    .from(cellServices)
    .innerJoin(cells, eq(cells.id, cellServices.cellId))
    .where(eq(cellServices.cellId, cellId));
}

async function fetchServiceRow(
  database: typeof db,
  cellId: string,
  serviceId: string
) {
  const [row] = await database
    .select({ service: cellServices, cell: cells })
    .from(cellServices)
    .innerJoin(cells, eq(cells.id, cellServices.cellId))
    .where(and(eq(cellServices.cellId, cellId), eq(cellServices.id, serviceId)))
    .limit(1);

  return row ?? null;
}

async function serializeService(
  database: typeof db,
  row: {
    service: typeof cellServices.$inferSelect;
    cell: typeof cells.$inferSelect;
  }
) {
  const { service, cell } = row;
  const logPath = computeServiceLogPath(cell.workspacePath, service.name);
  const recentLogs = await readLogTail(logPath);
  const processAlive = isProcessAlive(service.pid);
  const portReachable =
    typeof service.port === "number"
      ? await isPortActive(service.port)
      : undefined;

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

  const derivedPid = processAlive ? service.pid : null;
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
    port: service.port ?? undefined,
    pid: derivedPid ?? undefined,
    command: service.command,
    cwd: service.cwd,
    logPath,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs,
    processAlive,
    portReachable,
  };
}

async function readLogTail(logPath?: string | null): Promise<string | null> {
  if (!logPath) {
    return null;
  }

  try {
    const file = await fs.open(logPath, "r");
    try {
      const stats = await file.stat();
      const totalBytes = Number(stats.size ?? 0);
      if (totalBytes === 0) {
        return "";
      }
      const bytesToRead = Math.min(totalBytes, LOG_TAIL_MAX_BYTES);
      const start = totalBytes - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);
      await file.read(buffer, 0, bytesToRead, start);
      const lines = buffer.toString("utf8").split(LOG_LINE_SPLIT_RE);
      return lines.slice(-LOG_TAIL_MAX_LINES).join("\n").trimEnd();
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

function computeServiceLogPath(
  workspacePath: string,
  serviceName: string
): string {
  const safe = sanitizeServiceNameForLogs(serviceName);
  return resolvePath(workspacePath, SERVICE_LOG_DIR, `${safe}.log`);
}

function sanitizeServiceNameForLogs(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return normalized.length > 0 ? normalized : "service";
}
