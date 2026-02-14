import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  type AgentRuntimeService,
  agentRuntimeService,
} from "../agents/service";
import { DatabaseService } from "../db";
import { type LoggerService as Logger, LoggerService } from "../logger";
import { cells } from "../schema/cells";
import {
  type ServiceSupervisorService as ServiceSupervisorApi,
  ServiceSupervisorService,
} from "../services/supervisor";
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

export type WorkspaceRemovalResult = {
  workspace: WorkspaceRecord;
  deletedCellIds: string[];
};

type WorkspaceCellRow = {
  id: string;
  workspacePath: string | null;
};

type WorkspaceRemovalDependencies = {
  db: typeof DatabaseService.db;
  logger: Logger;
  supervisor: ServiceSupervisorApi;
  agentRuntime: AgentRuntimeService;
  worktreeManager: WorktreeManagerService;
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
    await deps.agentRuntime.closeAgentSession(cell.id).catch((cause: unknown) =>
      logWarning(deps.logger, "Failed to close agent session", {
        cellId: cell.id,
        error: formatError(cause),
      })
    );

    await deps.supervisor
      .stopCellServices(cell.id, { releasePorts: true })
      .catch((cause: unknown) =>
        logWarning(deps.logger, "Failed to stop cell services", {
          cellId: cell.id,
          error: formatError(cause),
        })
      );

    await cleanupCellWorkspace({
      workspaceRootPath: context.workspace.path,
      cellWorkspacePath: cell.workspacePath,
      cellId: cell.id,
      worktreeManager: deps.worktreeManager,
      logger: deps.logger,
    });

    deletedCellIds.push(cell.id);
  }

  if (deletedCellIds.length > 0) {
    await deleteCellsForWorkspace(deps.db, workspaceId);
  }

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
  await db
    .select({ id: cells.id, workspacePath: cells.workspacePath })
    .from(cells)
    .where(eq(cells.workspaceId, workspaceId));

const deleteCellsForWorkspace = async (
  db: typeof DatabaseService.db,
  workspaceId: string
): Promise<void> => {
  await db.delete(cells).where(eq(cells.workspaceId, workspaceId));
};

type CleanupArgs = {
  workspaceRootPath: string;
  cellWorkspacePath: string | null;
  cellId: string;
  worktreeManager: WorktreeManagerService;
  logger: Logger;
};

const cleanupCellWorkspace = async ({
  workspaceRootPath,
  cellWorkspacePath,
  cellId,
  worktreeManager,
  logger,
}: CleanupArgs): Promise<void> => {
  try {
    await worktreeManager.removeWorktree(workspaceRootPath, cellId);
  } catch (worktreeError) {
    await fallbackWorkspaceRemoval({
      cellWorkspacePath,
      cellId,
      worktreeError,
      logger,
    });
  }
};

type FallbackArgs = {
  cellWorkspacePath: string | null;
  cellId: string;
  worktreeError: unknown;
  logger: Logger;
};

const fallbackWorkspaceRemoval = async ({
  cellWorkspacePath,
  cellId,
  worktreeError,
  logger,
}: FallbackArgs): Promise<void> => {
  if (!cellWorkspacePath?.trim()) {
    logWarning(logger, "Worktree removal failed with no workspace path", {
      cellId,
      error: formatError(worktreeError),
    });
    return;
  }

  try {
    await rm(cellWorkspacePath, { recursive: true, force: true });
    logger.debug("Removed workspace directory after git cleanup failure", {
      cellId,
      workspacePath: cellWorkspacePath,
    });
  } catch (fsError) {
    logWarning(logger, "Failed to remove workspace directory", {
      cellId,
      workspacePath: cellWorkspacePath,
      worktreeError: formatError(worktreeError),
      error: formatError(fsError),
    });
  }
};

const logWarning = (
  logger: Logger,
  message: string,
  context?: Record<string, unknown>
) => logger.warn(message, context);

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
  return String(error);
};
