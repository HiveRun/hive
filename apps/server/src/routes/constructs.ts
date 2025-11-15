import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createConnection } from "node:net";
import { resolve as resolvePath } from "node:path";
import { logger } from "@bogeychan/elysia-logger";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia, type Static, t } from "elysia";
import { closeAgentSession, ensureAgentSession } from "../agents/service";
import { getSyntheticConfig } from "../config/context";
import type { Template } from "../config/schema";
import { db } from "../db";

import {
  ConstructDiffResponseSchema,
  ConstructListResponseSchema,
  ConstructResponseSchema,
  ConstructServiceListResponseSchema,
  ConstructServiceSchema,
  CreateConstructSchema,
  DeleteConstructsSchema,
} from "../schema/api";
import {
  type ConstructStatus,
  constructs,
  type NewConstruct,
} from "../schema/constructs";
import { constructServices } from "../schema/services";
import type { DiffMode } from "../services/diff-service";
import {
  getConstructDiffDetails,
  getConstructDiffSummary,
} from "../services/diff-service";
import { subscribeToServiceEvents } from "../services/events";
import {
  CommandExecutionError,
  ensureServicesForConstruct,
  isProcessAlive,
  startServiceById,
  stopServiceById,
  stopServicesForConstruct,
  TemplateSetupError,
} from "../services/supervisor";
import { createWorktreeManager } from "../worktree/manager";

export type ConstructRouteDependencies = {
  db: typeof db;
  getSyntheticConfig: typeof getSyntheticConfig;
  ensureAgentSession: typeof ensureAgentSession;
  closeAgentSession: typeof closeAgentSession;
  createWorktreeManager: typeof createWorktreeManager;
  ensureServicesForConstruct: typeof ensureServicesForConstruct;
  startServiceById: typeof startServiceById;
  stopServiceById: typeof stopServiceById;
  stopServicesForConstruct: typeof stopServicesForConstruct;
};

const defaultConstructRouteDependencies: ConstructRouteDependencies = {
  db,
  getSyntheticConfig,
  ensureAgentSession,
  closeAgentSession,
  createWorktreeManager,
  ensureServicesForConstruct,
  startServiceById,
  stopServiceById,
  stopServicesForConstruct,
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
const SERVICE_LOG_DIR = ".synthetic/logs";
const PORT_CHECK_TIMEOUT_MS = 500;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

const LOGGER_CONFIG = {
  level: process.env.LOG_LEVEL || "info",
  autoLogging: false,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" as const }
      : undefined,
} as const;

const DiffModeSchema = t.Union([t.Literal("workspace"), t.Literal("branch")]);
const DiffQuerySchema = t.Object({
  mode: t.Optional(DiffModeSchema),
  files: t.Optional(t.String()),
});

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

function constructToResponse(construct: typeof constructs.$inferSelect) {
  return {
    id: construct.id,
    name: construct.name,
    description: construct.description,
    templateId: construct.templateId,
    workspacePath: construct.workspacePath,
    opencodeSessionId: construct.opencodeSessionId,
    opencodeServerUrl: construct.opencodeServerUrl,
    opencodeServerPort: construct.opencodeServerPort,
    createdAt: construct.createdAt.toISOString(),
    status: construct.status,
    lastSetupError: construct.lastSetupError ?? undefined,
    branchName: construct.branchName ?? undefined,
    baseCommit: construct.baseCommit ?? undefined,
  };
}

type ParsedDiffRequest = {
  mode: DiffMode;
  files: string[];
};

type DiffRequestParseResult =
  | { ok: true; value: ParsedDiffRequest }
  | { ok: false; status: number; message: string };

function parseDiffRequest(
  construct: typeof constructs.$inferSelect,
  query: Static<typeof DiffQuerySchema>
): DiffRequestParseResult {
  const mode = (query.mode ?? "workspace") as DiffMode;
  if (mode === "branch" && !construct.baseCommit) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: "Construct is missing base commit metadata",
    };
  }

  const files = Array.from(
    new Set(
      (query.files ?? "")
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean)
    )
  );

  return {
    ok: true,
    value: {
      mode,
      files,
    },
  };
}

type ErrorPayload = {
  message: string;
  details?: string;
};

export function createConstructsRoutes(
  overrides: Partial<ConstructRouteDependencies> = {}
) {
  const deps = { ...defaultConstructRouteDependencies, ...overrides };
  const {
    db: database,
    getSyntheticConfig: loadSyntheticConfig,
    ensureAgentSession: ensureSession,
    closeAgentSession: closeSession,
    createWorktreeManager: buildWorktreeManager,
    ensureServicesForConstruct: ensureServices,
    startServiceById: startService,
    stopServiceById: stopService,
    stopServicesForConstruct: stopConstructServicesFn,
  } = deps;

  return new Elysia({ prefix: "/api/constructs" })
    .use(logger(LOGGER_CONFIG))
    .get(
      "/",
      async () => {
        const allConstructs = await database.select().from(constructs);
        return { constructs: allConstructs.map(constructToResponse) };
      },
      {
        response: {
          200: ConstructListResponseSchema,
        },
      }
    )
    .get(
      "/:id",
      async ({ params, set }) => {
        const result = await database
          .select()
          .from(constructs)
          .where(eq(constructs.id, params.id))
          .limit(1);

        if (result.length === 0) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const [construct] = result;
        if (!construct) {
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to load construct" };
        }

        return constructToResponse(construct);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        response: {
          200: ConstructResponseSchema,
          404: t.Object({
            message: t.String(),
          }),
        },
      }
    )
    .get(
      "/:id/services",
      async ({ params, set }) => {
        const construct = await loadConstructById(database, params.id);
        if (!construct) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
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
          200: ConstructServiceListResponseSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .get(
      "/:id/services/stream",
      async ({ params, set, log }) => {
        const construct = await loadConstructById(database, params.id);
        if (!construct) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
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
        const construct = await loadConstructById(database, params.id);
        if (!construct) {
          set.status = HTTP_STATUS.NOT_FOUND;
          return { message: "Construct not found" };
        }

        const parsed = parseDiffRequest(construct, query);
        if (!parsed.ok) {
          set.status = parsed.status;
          return { message: parsed.message };
        }

        try {
          const summary = await getConstructDiffSummary({
            workspacePath: construct.workspacePath,
            mode: parsed.value.mode,
            baseCommit: construct.baseCommit ?? null,
          });

          const details = parsed.value.files.length
            ? await getConstructDiffDetails({
                workspacePath: construct.workspacePath,
                mode: parsed.value.mode,
                baseCommit: summary.baseCommit,
                files: parsed.value.files,
                summaryFiles: summary.files,
              })
            : undefined;

          return {
            mode: parsed.value.mode,
            baseCommit: summary.baseCommit,
            headCommit: summary.headCommit,
            files: summary.files,
            details,
          };
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
          200: ConstructDiffResponseSchema,
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
          200: ConstructServiceSchema,
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
          200: ConstructServiceSchema,
          404: t.Object({ message: t.String() }),
        },
      }
    )
    .post(
      "/",
      async ({ body, set, log }) => {
        const result = await handleConstructCreationRequest({
          body,
          database,
          ensureSession,
          ensureServices,
          stopConstructServices: stopConstructServicesFn,
          buildWorktreeManager,
          loadSyntheticConfig,
          log,
        });

        set.status = result.status;
        return result.payload;
      },
      {
        body: CreateConstructSchema,
        response: {
          201: ConstructResponseSchema,
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

          const constructsToDelete = await database
            .select({
              id: constructs.id,
              workspacePath: constructs.workspacePath,
            })
            .from(constructs)
            .where(inArray(constructs.id, uniqueIds));

          if (constructsToDelete.length === 0) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "No constructs found for provided ids" };
          }

          const worktreeService = buildWorktreeManager();

          for (const construct of constructsToDelete) {
            await closeSession(construct.id);
            try {
              await stopConstructServicesFn(construct.id, {
                releasePorts: true,
              });
            } catch (error) {
              log.warn(
                { error, constructId: construct.id },
                "Failed to stop services before deletion"
              );
            }
            await removeConstructWorkspace(worktreeService, construct, log);
          }

          const idsToDelete = constructsToDelete.map(
            (construct) => construct.id
          );

          await database
            .delete(constructs)
            .where(inArray(constructs.id, idsToDelete));

          return { deletedIds: idsToDelete };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete constructs");
          } else {
            log.error({ error }, "Failed to delete constructs");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete constructs" };
        }
      },
      {
        body: DeleteConstructsSchema,
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
          const construct = await loadConstructById(database, params.id);
          if (!construct) {
            set.status = HTTP_STATUS.NOT_FOUND;
            return { message: "Construct not found" };
          }

          await closeSession(params.id);
          try {
            await stopConstructServicesFn(params.id, { releasePorts: true });
          } catch (error) {
            log.warn(
              { error, constructId: params.id },
              "Failed to stop services before construct removal"
            );
          }

          const worktreeService = buildWorktreeManager();
          await removeConstructWorkspace(worktreeService, construct, log);

          await database.delete(constructs).where(eq(constructs.id, params.id));

          return { message: "Construct deleted successfully" };
        } catch (error) {
          if (error instanceof Error) {
            log.error(error, "Failed to delete construct");
          } else {
            log.error({ error }, "Failed to delete construct");
          }
          set.status = HTTP_STATUS.INTERNAL_ERROR;
          return { message: "Failed to delete construct" };
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

export const constructsRoutes = createConstructsRoutes();

type ConstructCreationResult = {
  status: number;
  payload: ConstructCreationPayload;
};

type ConstructCreationPayload =
  | ReturnType<typeof constructToResponse>
  | ErrorPayload;

type ConstructCreationArgs = {
  body: Static<typeof CreateConstructSchema>;
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForConstruct;
  stopConstructServices: typeof stopServicesForConstruct;
  buildWorktreeManager: typeof createWorktreeManager;
  loadSyntheticConfig: typeof getSyntheticConfig;
  log: LoggerLike;
};

async function handleConstructCreationRequest(
  args: ConstructCreationArgs
): Promise<ConstructCreationResult> {
  const {
    body,
    database,
    ensureSession,
    ensureServices,
    stopConstructServices,
    buildWorktreeManager,
    loadSyntheticConfig,
    log,
  } = args;

  const syntheticConfig = await loadSyntheticConfig();
  const template = syntheticConfig.templates[body.templateId];
  if (!template) {
    return {
      status: HTTP_STATUS.BAD_REQUEST,
      payload: { message: "Template not found" },
    };
  }

  const worktreeService = buildWorktreeManager(process.cwd(), syntheticConfig);
  const context = createProvisionContext({
    body,
    template,
    database,
    ensureSession,
    ensureServices,
    stopConstructServices,
    worktreeService,
    log,
  });

  try {
    const construct = await createConstructWithServices(context);
    return {
      status: HTTP_STATUS.CREATED,
      payload: constructToResponse(construct),
    };
  } catch (error) {
    return recoverConstructCreationFailure(context, error);
  }
}

type ProvisionContext = {
  body: Static<typeof CreateConstructSchema>;
  template: Template;
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForConstruct;
  stopConstructServices: typeof stopServicesForConstruct;
  worktreeService: ReturnType<typeof createWorktreeManager>;
  log: LoggerLike;
  state: ConstructProvisionState;
};

type ConstructProvisionState = {
  constructId: string;
  worktreeCreated: boolean;
  recordCreated: boolean;
  servicesStarted: boolean;
  workspacePath: string | null;
  branchName: string | null;
  baseCommit: string | null;
  createdConstruct: typeof constructs.$inferSelect | null;
};

function createProvisionContext(args: {
  body: Static<typeof CreateConstructSchema>;
  template: Template;
  database: typeof db;
  ensureSession: typeof ensureAgentSession;
  ensureServices: typeof ensureServicesForConstruct;
  stopConstructServices: typeof stopServicesForConstruct;
  worktreeService: ReturnType<typeof createWorktreeManager>;
  log: LoggerLike;
}): ProvisionContext {
  return {
    ...args,
    state: {
      constructId: randomUUID(),
      worktreeCreated: false,
      recordCreated: false,
      servicesStarted: false,
      workspacePath: null,
      branchName: null,
      baseCommit: null,
      createdConstruct: null,
    },
  };
}

async function createConstructWithServices(
  context: ProvisionContext
): Promise<typeof constructs.$inferSelect> {
  const {
    body,
    template,
    database,
    ensureSession,
    ensureServices,
    worktreeService,
    state,
  } = context;

  const worktree = await worktreeService.createWorktree(state.constructId, {
    templateId: body.templateId,
  });
  state.worktreeCreated = true;
  state.workspacePath = worktree.path;
  state.branchName = worktree.branch;
  state.baseCommit = worktree.baseCommit;

  const timestamp = new Date();
  const newConstruct: NewConstruct = {
    id: state.constructId,
    name: body.name,
    description: body.description ?? null,
    templateId: body.templateId,
    workspacePath: worktree.path,
    branchName: worktree.branch,
    baseCommit: worktree.baseCommit,
    opencodeSessionId: null,
    opencodeServerUrl: null,
    opencodeServerPort: null,
    createdAt: timestamp,
    status: "pending",
    lastSetupError: null,
  };

  const [created] = await database
    .insert(constructs)
    .values(newConstruct)
    .returning();

  if (!created) {
    throw new Error("Failed to create construct record");
  }

  state.recordCreated = true;
  state.createdConstruct = created;

  await ensureSession(state.constructId);
  await ensureServices(created, template);

  state.servicesStarted = true;

  await updateConstructProvisioningStatus(database, state.constructId, "ready");

  const readyRecord = { ...created, status: "ready", lastSetupError: null };
  state.createdConstruct = readyRecord;
  return readyRecord;
}

async function recoverConstructCreationFailure(
  context: ProvisionContext,
  error: unknown
): Promise<ConstructCreationResult> {
  const payload = buildConstructCreationErrorPayload(error);
  const preserveResources = shouldPreserveConstructWorkspace(error);

  if (
    preserveResources &&
    context.state.recordCreated &&
    context.state.createdConstruct
  ) {
    const lastSetupError = deriveSetupErrorDetails(payload);

    await updateConstructProvisioningStatus(
      context.database,
      context.state.constructId,
      "error",
      lastSetupError
    );

    await cleanupProvisionResources(context, {
      preserveRecord: true,
      preserveWorktree: true,
    });

    const erroredConstruct = {
      ...context.state.createdConstruct,
      status: "error",
      lastSetupError,
    };

    context.state.createdConstruct = erroredConstruct;

    return {
      status: HTTP_STATUS.CREATED,
      payload: constructToResponse(erroredConstruct),
    };
  }

  await cleanupProvisionResources(context);

  if (error instanceof Error) {
    context.log.error(error, "Failed to create construct");
  } else {
    context.log.error({ error }, "Failed to create construct");
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
    await deleteConstructRecordIfCreated(context);
  }
}

async function stopServicesIfStarted(context: ProvisionContext) {
  if (!context.state.servicesStarted) {
    return;
  }

  try {
    await context.stopConstructServices(context.state.constructId, {
      releasePorts: true,
    });
  } catch (cleanupError) {
    context.log.warn(
      { cleanupError },
      "Failed to stop services during construct creation cleanup"
    );
  } finally {
    context.state.servicesStarted = false;
  }
}

async function removeWorktreeIfCreated(context: ProvisionContext) {
  if (!(context.state.worktreeCreated && context.state.workspacePath)) {
    return;
  }

  await removeConstructWorkspace(
    context.worktreeService,
    {
      id: context.state.constructId,
      workspacePath: context.state.workspacePath,
    },
    context.log
  );

  context.state.worktreeCreated = false;
  context.state.workspacePath = null;
}

async function deleteConstructRecordIfCreated(context: ProvisionContext) {
  if (!context.state.recordCreated) {
    return;
  }

  try {
    await context.database
      .delete(constructs)
      .where(eq(constructs.id, context.state.constructId));
  } catch (cleanupError) {
    context.log.warn(
      { cleanupError },
      "Failed to delete construct row during cleanup"
    );
  } finally {
    context.state.recordCreated = false;
    context.state.createdConstruct = null;
  }
}

type ConstructWorkspaceRecord = Pick<
  typeof constructs.$inferSelect,
  "id" | "workspacePath"
>;

type LoggerLike = {
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
};

function shouldPreserveConstructWorkspace(
  error: unknown
): error is TemplateSetupError {
  return error instanceof TemplateSetupError;
}

function deriveSetupErrorDetails(payload: ErrorPayload): string {
  const details = payload.details?.trim();
  return details?.length ? details : payload.message;
}

async function updateConstructProvisioningStatus(
  database: typeof db,
  constructId: string,
  status: ConstructStatus,
  lastSetupError?: string | null
): Promise<void> {
  await database
    .update(constructs)
    .set({ status, lastSetupError: lastSetupError ?? null })
    .where(eq(constructs.id, constructId));
}

function buildConstructCreationErrorPayload(error: unknown): ErrorPayload {
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

  return { message: "Failed to create construct" };
}

function formatStackTrace(error?: Error): string | undefined {
  if (!error) {
    return;
  }

  return error.stack ?? error.message;
}

async function removeConstructWorkspace(
  worktreeService: ReturnType<typeof createWorktreeManager>,
  construct: ConstructWorkspaceRecord,
  log: LoggerLike
) {
  try {
    worktreeService.removeWorktree(construct.id);
    return;
  } catch (error) {
    log.warn(
      { error, constructId: construct.id },
      "Failed to remove git worktree, attempting filesystem cleanup"
    );
  }

  if (!construct.workspacePath) {
    return;
  }

  try {
    await fs.rm(construct.workspacePath, { recursive: true, force: true });
  } catch (error) {
    log.warn(
      {
        error,
        constructId: construct.id,
        workspacePath: construct.workspacePath,
      },
      "Failed to remove construct workspace directory"
    );
  }
}

async function loadConstructById(
  database: typeof db,
  constructId: string
): Promise<typeof constructs.$inferSelect | null> {
  const [construct] = await database
    .select()
    .from(constructs)
    .where(eq(constructs.id, constructId))
    .limit(1);

  return construct ?? null;
}

function fetchServiceRows(database: typeof db, constructId: string) {
  return database
    .select({ service: constructServices, construct: constructs })
    .from(constructServices)
    .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
    .where(eq(constructServices.constructId, constructId));
}

async function fetchServiceRow(
  database: typeof db,
  constructId: string,
  serviceId: string
) {
  const [row] = await database
    .select({ service: constructServices, construct: constructs })
    .from(constructServices)
    .innerJoin(constructs, eq(constructs.id, constructServices.constructId))
    .where(
      and(
        eq(constructServices.constructId, constructId),
        eq(constructServices.id, serviceId)
      )
    )
    .limit(1);

  return row ?? null;
}

async function serializeService(
  database: typeof db,
  row: {
    service: typeof constructServices.$inferSelect;
    construct: typeof constructs.$inferSelect;
  }
) {
  const { service, construct } = row;
  const logPath = computeServiceLogPath(construct.workspacePath, service.name);
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
      .update(constructServices)
      .set({
        status: derivedStatus,
        lastKnownError: derivedLastKnownError,
        pid: derivedPid,
        updatedAt: new Date(),
      })
      .where(eq(constructServices.id, service.id));
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
