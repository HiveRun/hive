import { eq } from "drizzle-orm";
import {
  type AgentRuntimeService,
  agentRuntimeService,
} from "../agents/service";
import { DatabaseService } from "../db";
import { type LoggerService as Logger, LoggerService } from "../logger";
import { type Cell, cells } from "../schema/cells";
import { linearIntegrations } from "../schema/linear-integrations";
import { deleteCellWithLifecycle } from "../services/cell-delete-lifecycle";
import { chatTerminalService } from "../services/chat-terminal";
import {
  type ServiceSupervisorService as ServiceSupervisorApi,
  ServiceSupervisorService,
} from "../services/supervisor";
import { cellTerminalService } from "../services/terminal";
import {
  type WorktreeManagerService,
  worktreeManagerService,
} from "../worktree/manager";
import {
  resolveWorkspaceContext,
  WorkspaceContextError,
  type WorkspaceRuntimeContext,
} from "./context";
import { removeWorkspace, type WorkspaceRecord } from "./registry";

type WorkspaceRemovalResult = {
  workspace: WorkspaceRecord;
  deletedCellIds: string[];
};

type WorkspaceCellRow = Cell;

type WorkspaceRemovalDependencies = {
  db: typeof DatabaseService.db;
  logger: Logger;
  supervisor: ServiceSupervisorApi;
  agentRuntime: AgentRuntimeService;
  worktreeManager: WorktreeManagerService;
  closeTerminalSession: (cellId: string) => void;
  closeChatTerminalSession: (cellId: string) => void;
  resolveWorkspaceContext: (
    workspaceId: string
  ) => Promise<WorkspaceRuntimeContext>;
  removeWorkspace: (workspaceId: string) => Promise<boolean>;
};

const defaultDependencies = (): WorkspaceRemovalDependencies => ({
  db: DatabaseService.db,
  logger: LoggerService,
  supervisor: ServiceSupervisorService,
  agentRuntime: agentRuntimeService,
  worktreeManager: worktreeManagerService,
  closeTerminalSession: cellTerminalService.closeSession,
  closeChatTerminalSession: chatTerminalService.closeSession,
  resolveWorkspaceContext,
  removeWorkspace,
});

export async function removeWorkspaceCascade(
  workspaceId: string,
  overrides: Partial<WorkspaceRemovalDependencies> = {}
): Promise<WorkspaceRemovalResult | null> {
  const deps = { ...defaultDependencies(), ...overrides };

  const context = await deps
    .resolveWorkspaceContext(workspaceId)
    .catch((error: unknown) => {
      if (error instanceof WorkspaceContextError) {
        return null;
      }
      throw error;
    });

  if (!context) {
    return null;
  }

  const workspaceCells = await fetchCellsForWorkspace(deps.db, workspaceId);
  const deletedCellIds: string[] = [];

  for (const cell of workspaceCells) {
    await deleteCellWithLifecycle({
      database: deps.db,
      cell,
      closeSession: deps.agentRuntime.closeAgentSession,
      closeTerminalSession: deps.closeTerminalSession,
      closeChatTerminalSession: deps.closeChatTerminalSession,
      clearSetupTerminal: deps.supervisor.clearSetupTerminal,
      stopCellServices: deps.supervisor.stopCellServices,
      runCellTeardown: deps.supervisor.runCellTeardown,
      getWorktreeService: async () => ({
        createWorktree: () =>
          Promise.reject(
            new Error("Workspace deletion cannot create worktrees")
          ),
        removeWorktree: (cellId) =>
          deps.worktreeManager.removeWorktree(context.workspace.path, cellId),
      }),
      log: createLifecycleLogger(deps.logger),
    });
    deletedCellIds.push(cell.id);
  }

  await deleteLinearIntegrationForWorkspace(deps.db, workspaceId);

  await deps.removeWorkspace(workspaceId).catch((cause: unknown) =>
    logWarning(deps.logger, "Failed to remove workspace registry entry", {
      workspaceId,
      error: formatError(cause),
    })
  );

  return { workspace: context.workspace, deletedCellIds };
}

const fetchCellsForWorkspace = async (
  db: typeof DatabaseService.db,
  workspaceId: string
): Promise<WorkspaceCellRow[]> =>
  await db.select().from(cells).where(eq(cells.workspaceId, workspaceId));

const deleteLinearIntegrationForWorkspace = async (
  db: typeof DatabaseService.db,
  workspaceId: string
): Promise<void> => {
  await db
    .delete(linearIntegrations)
    .where(eq(linearIntegrations.workspaceId, workspaceId));
};

const logWarning = (
  logger: Logger,
  message: string,
  context?: Record<string, unknown>
) => logger.warn(message, context);

const createLifecycleLogger = (logger: Logger) => ({
  info: (context: Record<string, unknown>, message?: string) =>
    logger.info(message ?? "Cell deletion lifecycle", context),
  warn: (context: Record<string, unknown>, message?: string) =>
    logger.warn(message ?? "Cell deletion lifecycle warning", context),
  error: (context: Record<string, unknown> | Error, message?: string) =>
    logger.error(
      message ?? "Cell deletion lifecycle error",
      context instanceof Error ? { error: context.message } : context
    ),
});

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in (error as { message?: unknown }) &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (error && typeof error === "object" && "cause" in error) {
    return formatError((error as { cause: unknown }).cause);
  }
  return String(error);
};
