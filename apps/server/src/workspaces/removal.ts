import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { closeAgentSession as closeDefaultAgentSession } from "../agents/service";
import { db as defaultDb } from "../db";
import { runServerEffect } from "../runtime";
import { cells } from "../schema/cells";
import { stopServicesForCell as stopDefaultCellServices } from "../services/supervisor";
import {
  resolveWorkspaceContext,
  WorkspaceContextError,
  type WorkspaceRuntimeContext,
} from "./context";
import { removeWorkspaceEffect, type WorkspaceRecord } from "./registry";

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

  let workspaceContext: WorkspaceRuntimeContext;
  try {
    workspaceContext = await resolveWorkspaceContext(workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      return null;
    }

    logWorkspaceRemovalWarning("Failed to resolve workspace context", {
      workspaceId,
      error: formatError(error),
    });
    return null;
  }

  const cellsForWorkspace = await database
    .select({
      id: cells.id,
      workspacePath: cells.workspacePath,
    })
    .from(cells)
    .where(eq(cells.workspaceId, workspaceId));

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

    await cleanupCellWorkspace(workspaceContext, cell.id, cell.workspacePath);

    deletedCellIds.push(cell.id);
  }

  if (deletedCellIds.length > 0) {
    await database.delete(cells).where(eq(cells.workspaceId, workspaceId));
  }

  await runServerEffect(removeWorkspaceEffect(workspaceId));

  return { workspace: workspaceContext.workspace, deletedCellIds };
}

async function cleanupCellWorkspace(
  workspaceContext: WorkspaceRuntimeContext,
  cellId: string,
  workspacePath?: string | null
): Promise<void> {
  try {
    await workspaceContext.removeWorktree(cellId);
    return;
  } catch (error) {
    logWorkspaceRemovalWarning("Failed to remove git worktree", {
      cellId,
      error: formatError(error),
    });
  }

  if (workspacePath && workspacePath.trim().length > 0) {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      logWorkspaceRemovalWarning("Failed to remove workspace directory", {
        cellId,
        workspacePath,
        error: formatError(error),
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
