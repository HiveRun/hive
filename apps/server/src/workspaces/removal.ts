import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Result, ResultAsync } from "neverthrow";
import { closeAgentSession as closeDefaultAgentSession } from "../agents/service";
import { db as defaultDb } from "../db";
import { cells } from "../schema/cells";
import { stopServicesForCell as stopDefaultCellServices } from "../services/supervisor";
import type { WorktreeManager } from "../worktree/manager";
import {
  createWorktreeManager,
  describeWorktreeError,
} from "../worktree/manager";
import {
  getWorkspaceRegistry,
  removeWorkspace as removeWorkspaceRecord,
  type WorkspaceRecord,
} from "./registry";

export type WorkspaceRemovalResult = {
  workspace: WorkspaceRecord;
  deletedCellIds: string[];
};

export type WorkspaceRemovalDependencies = {
  db: typeof defaultDb;
  stopCellServices: typeof stopDefaultCellServices;
  closeAgentSession: typeof closeDefaultAgentSession;
};

const defaultDependencies: WorkspaceRemovalDependencies = {
  db: defaultDb,
  stopCellServices: stopDefaultCellServices,
  closeAgentSession: closeDefaultAgentSession,
};

export async function removeWorkspaceCascade(
  workspaceId: string,
  overrides: Partial<WorkspaceRemovalDependencies> = {}
): Promise<WorkspaceRemovalResult | null> {
  const {
    db: database,
    stopCellServices,
    closeAgentSession,
  } = {
    ...defaultDependencies,
    ...overrides,
  };

  const registry = await getWorkspaceRegistry();
  const workspace = registry.workspaces.find(
    (entry) => entry.id === workspaceId
  );
  if (!workspace) {
    return null;
  }

  const cellsForWorkspace = await database
    .select({
      id: cells.id,
      workspacePath: cells.workspacePath,
    })
    .from(cells)
    .where(eq(cells.workspaceId, workspaceId));

  let worktreeManager: WorktreeManager | null = null;
  const safeCreateWorktreeManager = Result.fromThrowable(
    createWorktreeManager,
    (error) => error
  );
  const worktreeResult = safeCreateWorktreeManager(workspace.path);

  if (worktreeResult.isOk()) {
    worktreeManager = worktreeResult.value;
  } else {
    logWorkspaceRemovalWarning("Failed to initialize worktree manager", {
      workspaceId,
      error: formatError(worktreeResult.error),
    });
  }

  const deletedCellIds: string[] = [];

  for (const cell of cellsForWorkspace) {
    await closeAgentSession(cell.id).catch((error) =>
      logWorkspaceRemovalWarning("Failed to close agent session", {
        cellId: cell.id,
        error: formatError(error),
      })
    );

    await stopCellServices(cell.id, { releasePorts: true }).catch((error) =>
      logWorkspaceRemovalWarning("Failed to stop cell services", {
        cellId: cell.id,
        error: formatError(error),
      })
    );

    await cleanupCellWorkspace(worktreeManager, cell.id, cell.workspacePath);

    deletedCellIds.push(cell.id);
  }

  if (deletedCellIds.length > 0) {
    await database.delete(cells).where(eq(cells.workspaceId, workspaceId));
  }

  await removeWorkspaceRecord(workspaceId);

  return { workspace, deletedCellIds };
}

async function cleanupCellWorkspace(
  manager: WorktreeManager | null,
  cellId: string,
  workspacePath?: string | null
): Promise<void> {
  if (manager) {
    const removeResult = await manager.removeWorktree(cellId);
    if (removeResult.isOk()) {
      return;
    }

    logWorkspaceRemovalWarning("Failed to remove git worktree", {
      cellId,
      error: describeWorktreeError(removeResult.error),
    });
  }

  if (workspacePath && workspacePath.trim().length > 0) {
    const removalResult = await ResultAsync.fromPromise(
      rm(workspacePath, { recursive: true, force: true }),
      (error) => error
    );

    if (removalResult.isErr()) {
      logWorkspaceRemovalWarning("Failed to remove workspace directory", {
        cellId,
        workspacePath,
        error: formatError(removalResult.error),
      });
    }
  }
}

function logWorkspaceRemovalWarning(
  message: string,
  context?: Record<string, unknown>
) {
  const serializedContext = context ? ` ${JSON.stringify(context)}` : "";
  process.stderr.write(`[workspace-removal] ${message}${serializedContext}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
