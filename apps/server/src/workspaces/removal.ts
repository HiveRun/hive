import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { closeAgentSession as closeDefaultAgentSession } from "../agents/service";
import { db as defaultDb } from "../db";
import { constructs } from "../schema/constructs";
import { stopServicesForConstruct as stopDefaultConstructServices } from "../services/supervisor";
import type { WorktreeManager } from "../worktree/manager";
import { createWorktreeManager } from "../worktree/manager";
import {
  getWorkspaceRegistry,
  removeWorkspace as removeWorkspaceRecord,
  type WorkspaceRecord,
} from "./registry";

export type WorkspaceRemovalResult = {
  workspace: WorkspaceRecord;
  deletedConstructIds: string[];
};

export type WorkspaceRemovalDependencies = {
  db: typeof defaultDb;
  stopConstructServices: typeof stopDefaultConstructServices;
  closeAgentSession: typeof closeDefaultAgentSession;
};

const defaultDependencies: WorkspaceRemovalDependencies = {
  db: defaultDb,
  stopConstructServices: stopDefaultConstructServices,
  closeAgentSession: closeDefaultAgentSession,
};

export async function removeWorkspaceCascade(
  workspaceId: string,
  overrides: Partial<WorkspaceRemovalDependencies> = {}
): Promise<WorkspaceRemovalResult | null> {
  const {
    db: database,
    stopConstructServices,
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

  const constructsForWorkspace = await database
    .select({
      id: constructs.id,
      workspacePath: constructs.workspacePath,
    })
    .from(constructs)
    .where(eq(constructs.workspaceId, workspaceId));

  let worktreeManager: WorktreeManager | null = null;
  try {
    worktreeManager = createWorktreeManager(workspace.path);
  } catch (error) {
    logWorkspaceRemovalWarning("Failed to initialize worktree manager", {
      workspaceId,
      error: formatError(error),
    });
  }

  const deletedConstructIds: string[] = [];

  for (const construct of constructsForWorkspace) {
    await closeAgentSession(construct.id).catch((error) =>
      logWorkspaceRemovalWarning("Failed to close agent session", {
        constructId: construct.id,
        error: formatError(error),
      })
    );

    await stopConstructServices(construct.id, { releasePorts: true }).catch(
      (error) =>
        logWorkspaceRemovalWarning("Failed to stop construct services", {
          constructId: construct.id,
          error: formatError(error),
        })
    );

    await cleanupConstructWorkspace(
      worktreeManager,
      construct.id,
      construct.workspacePath
    );

    deletedConstructIds.push(construct.id);
  }

  if (deletedConstructIds.length > 0) {
    await database
      .delete(constructs)
      .where(eq(constructs.workspaceId, workspaceId));
  }

  await removeWorkspaceRecord(workspaceId);

  return { workspace, deletedConstructIds };
}

async function cleanupConstructWorkspace(
  manager: WorktreeManager | null,
  constructId: string,
  workspacePath?: string | null
): Promise<void> {
  if (manager) {
    try {
      manager.removeWorktree(constructId);
      return;
    } catch (error) {
      logWorkspaceRemovalWarning("Failed to remove git worktree", {
        constructId,
        error: formatError(error),
      });
    }
  }

  if (workspacePath && workspacePath.trim().length > 0) {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      logWorkspaceRemovalWarning("Failed to remove workspace directory", {
        constructId,
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
