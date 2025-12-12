import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createConnection } from "node:net";
import { resolve as resolvePath } from "node:path";

import { logger } from "@bogeychan/elysia-logger";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Elysia, type Static, t } from "elysia";
import type { AgentRuntimeService } from "../agents/service";
import { AgentRuntimeServiceTag } from "../agents/service";
import type { Template } from "../config/schema";
import {
  DatabaseService,
  type DatabaseService as DatabaseServiceType,
} from "../db";
import { runServerEffect } from "../runtime";
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
import {
  type CellProvisioningState,
  cellProvisioningStates,
} from "../schema/cell-provisioning";
import { type CellStatus, cells, type NewCell } from "../schema/cells";
import { cellServices } from "../schema/services";
import {
  buildCellDiffPayload,
  parseDiffRequest,
} from "../services/diff-route-helpers";
import { subscribeToServiceEvents } from "../services/events";
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
  type ResolveWorkspaceContext,
  resolveWorkspaceContextEffect,
  type WorkspaceRuntimeContext,
} from "../workspaces/context";
import { createWorkspaceContextPlugin } from "../workspaces/plugin";
import type { WorkspaceRecord } from "../workspaces/registry";
import {
  describeWorktreeError,
  type WorktreeManager,
  type WorktreeManagerError,
  worktreeErrorToError,
} from "../worktree/manager";

type DatabaseClient = DatabaseServiceType["db"];

export type CellRouteDependencies = {
  db: DatabaseClient;
  resolveWorkspaceContext: ResolveWorkspaceContext;
  ensureAgentSession: AgentRuntimeService["ensureAgentSession"];
  sendAgentMessage: AgentRuntimeService["sendAgentMessage"];
  closeAgentSession: AgentRuntimeService["closeAgentSession"];
  ensureServicesForCell: ServiceSupervisorServiceType["ensureCellServices"];
  startServiceById: ServiceSupervisorServiceType["startCellService"];
  stopServiceById: ServiceSupervisorServiceType["stopCellService"];
  stopServicesForCell: ServiceSupervisorServiceType["stopCellServices"];
};

const dependencyKeys: Array<keyof CellRouteDependencies> = [
  "db",
  "resolveWorkspaceContext",
  "ensureAgentSession",
  "sendAgentMessage",
  "closeAgentSession",
  "ensureServicesForCell",
  "startServiceById",
  "stopServiceById",
  "stopServicesForCell",
];

const buildDefaultCellDependencies = () =>
  Effect.gen(function* () {
    const { db: database } = yield* DatabaseService;
    const agentRuntime = yield* AgentRuntimeServiceTag;
    const supervisor = yield* ServiceSupervisorService;

    return {
      db: database,
      resolveWorkspaceContext: (workspaceId) =>
        resolveWorkspaceContextEffect(workspaceId),
      ensureAgentSession: agentRuntime.ensureAgentSession,
      sendAgentMessage: agentRuntime.sendAgentMessage,
      closeAgentSession: agentRuntime.closeAgentSession,
      ensureServicesForCell: supervisor.ensureCellServices,
      startServiceById: supervisor.startCellService,
      stopServiceById: supervisor.stopCellService,
      stopServicesForCell: supervisor.stopCellServices,
    } satisfies CellRouteDependencies;
  });

const hasAllDependencies = (
  overrides: Partial<CellRouteDependencies>
): overrides is CellRouteDependencies =>
  dependencyKeys.every((key) => overrides[key] !== undefined);

const resolveCellRouteDependenciesEffect = (
  overrides: Partial<CellRouteDependencies> = {}
) =>
  hasAllDependencies(overrides)
    ? Effect.succeed(overrides)
    : buildDefaultCellDependencies().pipe(
        Effect.map((base) => ({ ...base, ...overrides }))
      );

const resolveCellRouteDependencies = (() => {
  let cachedBaseDeps: Promise<CellRouteDependencies> | null = null;

  const loadBase = () => {
    if (!cachedBaseDeps) {
      cachedBaseDeps = runServerEffect(buildDefaultCellDependencies());
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

const LOG_TAIL_MAX_BYTES = 64_000;
const LOG_TAIL_MAX_LINES = 200;
const LOG_LINE_SPLIT_RE = /\r?\n/;
const SERVICE_LOG_DIR = ".hive/logs";
const PORT_CHECK_TIMEOUT_MS = 500;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_PROVISIONING_ATTEMPTS = 3;

const PROVISIONING_INTERRUPTED_MESSAGE =
  "Provisioning interrupted. Fix the workspace and rerun setup.";

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
    opencodeCommand: buildOpencodeCommand(cell),
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
  cell: Pick<
    typeof cells.$inferSelect,
    | "workspacePath"
    | "opencodeSessionId"
    | "opencodeServerUrl"
    | "opencodeServerPort"
  >
): string | null {
  if (!(cell.workspacePath && cell.opencodeSessionId)) {
    return null;
  }

  const args = [
    "opencode",
    shellQuote(cell.workspacePath),
    "--session",
    shellQuote(cell.opencodeSessionId),
  ];

  const { hostname, port } = deriveServerOptions(cell);
  if (hostname) {
    args.push("--hostname", shellQuote(hostname));
  }
  if (port) {
    args.push("--port", shellQuote(port));
  }

  return args.join(" ");
}

function deriveServerOptions(
  cell: Pick<
    typeof cells.$inferSelect,
    "opencodeServerUrl" | "opencodeServerPort"
  >
): { hostname?: string; port?: string } {
  const options: { hostname?: string; port?: string } = {};

  if (cell.opencodeServerUrl) {
    try {
      const parsed = new URL(cell.opencodeServerUrl);
      if (parsed.hostname) {
        options.hostname = parsed.hostname;
      }
      if (parsed.port) {
        options.port = parsed.port;
      }
    } catch {
      // ignore invalid url fragments; fall back to explicit port if provided
    }
  }

  if (cell.opencodeServerPort) {
    options.port = String(cell.opencodeServerPort);
  }

  return options;
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
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
    resolveWorkspaceContext: (workspaceId) =>
      Effect.promise(() => resolveDeps()).pipe(
        Effect.flatMap((deps) => deps.resolveWorkspaceContext(workspaceId))
      ),
  });

  return new Elysia({ prefix: "/api/cells" })
    .use(logger(LOGGER_CONFIG))
    .use(workspaceContextPlugin)
    .post(
      "/:id/setup/retry",
      async ({ params, set }) => {
        const deps = await resolveDeps();
        const cell = await loadCellById(deps.db, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }
        if (cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return {
            message: "Cell is archived and cannot be retried",
          } satisfies {
            message: string;
          };
        }

        const workspaceContext = await runServerEffect(
          deps.resolveWorkspaceContext(cell.workspaceId)
        );
        const hiveConfig = await runServerEffect(workspaceContext.loadConfig());
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

          await runServerEffect(
            deps.ensureServicesForCell({
              cell: {
                ...cell,
                status: "pending",
                lastSetupError: null,
              },
              template,
            })
          );

          await deps.db
            .update(cells)
            .set({ status: "ready", lastSetupError: null })
            .where(eq(cells.id, cell.id));
        } catch (error) {
          const payload = buildCellCreationErrorPayload(error);
          const lastSetupError = deriveSetupErrorDetails(payload);
          await deps.db
            .update(cells)
            .set({ status: "error", lastSetupError })
            .where(eq(cells.id, cell.id));
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

        const extras = await buildSetupLogPayload(updated.workspacePath);
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
      "/:id",
      async ({ params, set }) => {
        const { db: database } = await resolveDeps();
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

        const extras = await buildSetupLogPayload(cell.workspacePath);
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
      async ({ params, set }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }
        if (cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Cell is archived" } satisfies {
            message: string;
          };
        }

        const rows = await fetchServiceRows(database, params.id);
        const services = await Promise.all(
          rows.map((row) => serializeService(database, row))
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
      "/:id/services/stream",
      async ({ params, set, log }) => {
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" };
        }
        if (cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Cell is archived" } satisfies {
            message: string;
          };
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
        const { db: database } = await resolveDeps();
        const cell = await loadCellById(database, params.id);
        if (!cell) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Cell not found" } satisfies { message: string };
        }
        if (cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Cell is archived" } satisfies {
            message: string;
          };
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
      "/:id/archive",
      async ({ params, set, log }) => {
        try {
          const deps = await resolveDeps();
          const {
            db: database,
            closeAgentSession: closeSession,
            stopServicesForCell: stopCellServicesFn,
          } = deps;

          const cell = await loadCellById(database, params.id);
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" } satisfies {
              message: string;
            };
          }
          if (cell.status === "archived") {
            return cellToResponse(cell);
          }

          await runServerEffect(closeSession(cell.id));
          try {
            await runServerEffect(
              stopCellServicesFn(cell.id, {
                releasePorts: true,
              })
            );
          } catch (error) {
            log.warn(
              { error, cellId: cell.id },
              "Failed to stop services before archive"
            );
          }

          await database
            .update(cells)
            .set({
              status: "archived",
              lastSetupError: null,
            })
            .where(eq(cells.id, cell.id));

          const updated = await loadCellById(database, cell.id);
          if (!updated) {
            set.status = HTTP_STATUS.INTERNAL_ERROR;
            return {
              message: "Failed to load cell after archive",
            } satisfies {
              message: string;
            };
          }

          return cellToResponse(updated);
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to archive cell");
          } else {
            log.error({ error }, "Failed to archive cell");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to archive cell" } satisfies {
            message: string;
          };
        }
      },
      {
        params: t.Object({ id: t.String() }),
        response: {
          200: CellResponseSchema,
          404: t.Object({ message: t.String() }),
          500: ErrorResponseSchema,
        },
      }
    )

    .post(
      "/:id/services/:serviceId/start",

      async ({ params, set }) => {
        const { db: database, startServiceById: startService } =
          await resolveDeps();

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
        if (row.cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Cell is archived" } satisfies {
            message: string;
          };
        }

        await runServerEffect(startService(params.serviceId));
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

        const serialized = await serializeService(database, updated);
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
      async ({ params, set }) => {
        const { db: database, stopServiceById: stopService } =
          await resolveDeps();

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
        if (row.cell.status === "archived") {
          set.status = HTTP_STATUS.BAD_REQUEST;
          return { message: "Cell is archived" } satisfies {
            message: string;
          };
        }

        await runServerEffect(stopService(params.serviceId));
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

        const serialized = await serializeService(database, updated);
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
          } = deps;

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
            const context = await runServerEffect(
              resolveWorkspaceCtx(workspaceId)
            );
            const manager = await runServerEffect(
              context.createWorktreeManager()
            );
            managerCache.set(workspaceId, manager);
            return manager;
          };

          for (const cell of cellsToDelete) {
            await runServerEffect(closeSession(cell.id));
            try {
              await runServerEffect(
                stopCellServicesFn(cell.id, {
                  releasePorts: true,
                })
              );
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
          } = deps;

          const cell = await loadCellById(database, params.id);
          if (!cell) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Cell not found" };
          }

          await runServerEffect(closeSession(params.id));
          try {
            await runServerEffect(
              stopCellServicesFn(params.id, { releasePorts: true })
            );
          } catch (error) {
            log.warn(
              { error, cellId: params.id },
              "Failed to stop services before cell removal"
            );
          }

          const workspaceManager = await runServerEffect(
            resolveWorkspaceCtx(cell.workspaceId)
          );
          const worktreeService = await runServerEffect(
            workspaceManager.createWorktreeManager()
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

  const hiveConfig = await runServerEffect(workspaceContext.loadConfig());
  const template = hiveConfig.templates[body.templateId];
  if (!template) {
    return {
      status: HTTP_STATUS.BAD_REQUEST,
      payload: { message: "Template not found" },
    };
  }

  const worktreeService = await runServerEffect(
    workspaceContext.createWorktreeManager()
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
      provisioningState: null,
    },
  };
}

function createExistingProvisionContextEffect(args: {
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
  return args.workspaceContext.createWorktreeManager().pipe(
    Effect.map((worktreeService) => ({
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
    }))
  );
}

async function createCellRecord(
  context: ProvisionContext
): Promise<typeof cells.$inferSelect> {
  const { body, database, worktreeService, workspace, state } = context;

  const worktree = await Effect.runPromise(
    worktreeService
      .createWorktree(state.cellId, {
        templateId: body.templateId,
      })
      .pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            context.log.error(
              {
                error: describeWorktreeError(error),
                cellId: state.cellId,
              },
              "Failed to create git worktree"
            )
          )
        ),
        Effect.mapError(worktreeErrorToError)
      )
  );
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

  const sessionOptions = {
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.providerId ? { providerId: body.providerId } : {}),
  };
  const session = await runServerEffect(
    ensureSession(
      state.cellId,
      Object.keys(sessionOptions).length ? sessionOptions : undefined
    )
  );
  await runServerEffect(
    ensureServices({
      cell: state.createdCell,
      template,
    })
  );

  state.servicesStarted = true;

  const initialPrompt = body.description?.trim();
  if (initialPrompt) {
    await runServerEffect(dispatchAgentMessage(session.id, initialPrompt));
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
    await runServerEffect(
      context.stopCellServices(context.state.cellId, {
        releasePorts: true,
      })
    );
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

const resumeSingleCellEffect = (
  deps: CellRouteDependencies,
  cell: typeof cells.$inferSelect,
  provisioningState: typeof cellProvisioningStates.$inferSelect | null
) =>
  Effect.gen(function* () {
    const attemptCount = provisioningState?.attemptCount ?? 0;
    if (attemptCount >= MAX_PROVISIONING_ATTEMPTS) {
      yield* Effect.tryPromise(() =>
        updateCellProvisioningStatus(
          deps.db,
          cell.id,
          "error",
          `${PROVISIONING_INTERRUPTED_MESSAGE}\nRetry limit exceeded.`
        )
      );
      return;
    }

    const workspaceContext = yield* deps.resolveWorkspaceContext(
      cell.workspaceId
    );
    const hiveConfig = yield* workspaceContext.loadConfig();

    const template = hiveConfig.templates[cell.templateId];
    if (!template) {
      yield* Effect.tryPromise(() =>
        updateCellProvisioningStatus(
          deps.db,
          cell.id,
          "error",
          `${PROVISIONING_INTERRUPTED_MESSAGE}\nTemplate ${cell.templateId} no longer exists.`
        )
      );
      return;
    }

    const context = yield* createExistingProvisionContextEffect({
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
  }).pipe(
    Effect.catchAll((error) =>
      Effect.tryPromise(() =>
        updateCellProvisioningStatus(
          deps.db,
          cell.id,
          "error",
          `${PROVISIONING_INTERRUPTED_MESSAGE}\n${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
    )
  );

const resumePendingCellsEffect = (
  overrides: Partial<CellRouteDependencies> = {}
) =>
  resolveCellRouteDependenciesEffect(overrides).pipe(
    Effect.flatMap((deps) =>
      Effect.gen(function* () {
        const pendingCells = yield* Effect.tryPromise({
          try: () =>
            deps.db
              .select({
                cell: cells,
                provisioningState: cellProvisioningStates,
              })
              .from(cells)
              .innerJoin(
                cellProvisioningStates,
                eq(cellProvisioningStates.cellId, cells.id)
              )
              .where(eq(cells.status, "spawning")),
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });

        if (pendingCells.length === 0) {
          return;
        }

        yield* Effect.forEach(
          pendingCells,
          ({ cell, provisioningState }) =>
            resumeSingleCellEffect(deps, cell, provisioningState),
          { discard: true, concurrency: 1 }
        );
      })
    )
  );

export async function resumeSpawningCells(
  overrides: Partial<CellRouteDependencies> = {}
): Promise<void> {
  await runServerEffect(resumePendingCellsEffect(overrides));
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
  worktreeService: WorktreeManager,
  cell: CellWorkspaceRecord,
  log: LoggerLike
) {
  try {
    await Effect.runPromise(worktreeService.removeWorktree(cell.id));
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

async function serializeService(database: DatabaseClient, row: ServiceRow) {
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
    ...(service.port != null ? { port: service.port } : {}),
    ...(derivedPid != null ? { pid: derivedPid } : {}),
    command: service.command,
    cwd: service.cwd,
    logPath,
    lastKnownError: derivedLastKnownError,
    env: service.env,
    updatedAt: service.updatedAt.toISOString(),
    recentLogs,
    processAlive,
    ...(portReachable !== undefined ? { portReachable } : {}),
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

function computeSetupLogPath(workspacePath: string): string {
  return resolvePath(workspacePath, SERVICE_LOG_DIR, "setup.log");
}

async function buildSetupLogPayload(workspacePath?: string | null) {
  if (!workspacePath) {
    return {};
  }

  const setupLogPath = computeSetupLogPath(workspacePath);
  const setupLog = await readLogTail(setupLogPath);
  return {
    setupLogPath,
    ...(setupLog != null ? { setupLog } : {}),
  };
}

function sanitizeServiceNameForLogs(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return normalized.length > 0 ? normalized : "service";
}
