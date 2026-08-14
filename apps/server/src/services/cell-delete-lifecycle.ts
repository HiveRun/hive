import { promises as fs } from "node:fs";

import { eq } from "drizzle-orm";

import type { DatabaseService as DatabaseServiceType } from "../db";
import { type Cell, type CellStatus, cells } from "../schema/cells";
import {
  type AsyncWorktreeManager,
  describeWorktreeError,
  type WorktreeManagerError,
} from "../worktree/manager";
import { runWithCellCleanupLock } from "./cell-cleanup-lock";
import { removeCellRuntimeDir } from "./cell-environment";
import { loadCellById } from "./cell-runtime-guard";
import { updateCellStatusAndEmit } from "./cell-status";
import type { TemplateTeardownReason } from "./supervisor";

type DatabaseClient = DatabaseServiceType["db"];

type DeleteLifecycleLogger = {
  info?: (obj: Record<string, unknown>, message?: string) => void;
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
};

type CellDeleteRecord = Cell;

type CellWorkspaceRecord = Pick<
  typeof cells.$inferSelect,
  "id" | "workspacePath"
>;

type DeleteLifecycleArgs = {
  database: DatabaseClient;
  cell: CellDeleteRecord;
  closeSession: (cellId: string) => Promise<unknown> | unknown;
  closeTerminalSession: (cellId: string) => void;
  closeChatTerminalSession?: (cellId: string) => void;
  clearSetupTerminal: (cellId: string) => void;
  stopCellServices: (
    cellId: string,
    args: {
      releasePorts: boolean;
    }
  ) => Promise<unknown>;
  runCellTeardown: (args: {
    cell: CellDeleteRecord;
    reason: TemplateTeardownReason;
  }) => Promise<unknown>;
  getWorktreeService: (workspaceId: string) => Promise<AsyncWorktreeManager>;
  removeRuntimeDirectory?: (cellId: string) => Promise<void>;
  log: DeleteLifecycleLogger;
};

const DELETE_CLOSE_AGENT_SESSION_TIMEOUT_MS = 15_000;
const DELETE_CLOSE_TERMINALS_TIMEOUT_MS = 5000;
const DELETE_REMOVE_RUNTIME_TIMEOUT_MS = 30_000;
const DELETE_REMOVE_WORKSPACE_TIMEOUT_MS = 120_000;
const DELETE_REMOVE_RECORD_TIMEOUT_MS = 10_000;

function runDeleteStepWithTimeout<T>(args: {
  step: string;
  timeoutMs: number;
  action: () => Promise<T> | T;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Delete step '${args.step}' timed out after ${args.timeoutMs}ms`
        )
      );
    }, args.timeoutMs);
    Promise.resolve()
      .then(args.action)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function markCellDeletionStarted(args: {
  database: DatabaseClient;
  cellId: string;
  workspaceId: string;
}) {
  await updateCellStatusAndEmit({
    database: args.database,
    cell: { id: args.cellId, workspaceId: args.workspaceId },
    status: "deleting",
  });
}

async function restoreCellStatusAfterDeleteFailure(args: {
  database: DatabaseClient;
  cellId: string;
  workspaceId: string;
  previousStatus: CellStatus;
}) {
  const existing = await loadCellById(args.database, args.cellId);
  if (!existing) {
    return;
  }

  await updateCellStatusAndEmit({
    database: args.database,
    cell: { id: args.cellId, workspaceId: args.workspaceId },
    status: args.previousStatus,
    lastSetupError: existing.lastSetupError ?? undefined,
  });
}

async function markCellDeletionFailure(args: {
  database: DatabaseClient;
  cellId: string;
  workspaceId: string;
  error: unknown;
  label: string;
  status?: "deleting" | "error";
}): Promise<Error> {
  const reason = formatLifecycleError(args.error);
  const lastSetupError = `${args.label} failed during cell deletion: ${reason}`;
  await updateCellStatusAndEmit({
    database: args.database,
    cell: { id: args.cellId, workspaceId: args.workspaceId },
    status: args.status ?? "error",
    lastSetupError,
  });
  return new Error(lastSetupError);
}

async function markCellTeardownComplete(args: {
  database: DatabaseClient;
  cell: CellDeleteRecord;
}) {
  await args.database
    .update(cells)
    .set({ deletionPhase: "teardown_complete" })
    .where(eq(cells.id, args.cell.id));
  args.cell.deletionPhase = "teardown_complete";
}

async function keepCellDeletionInProgress(args: {
  database: DatabaseClient;
  cell: CellDeleteRecord;
  error: unknown;
}) {
  const lastSetupError = formatLifecycleError(args.error);
  await updateCellStatusAndEmit({
    database: args.database,
    cell: args.cell,
    status: "deleting",
    lastSetupError,
  });
}

function formatLifecycleError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "cause" in error) {
    return formatLifecycleError((error as { cause: unknown }).cause);
  }
  return String(error);
}

export async function removeCellWorkspace(
  worktreeService: AsyncWorktreeManager,
  cell: CellWorkspaceRecord,
  log: DeleteLifecycleLogger
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

async function deleteCellWithTiming(
  args: DeleteLifecycleArgs,
  onFailure: (label: string, error: unknown) => Promise<Error>
) {
  const runStep = async <T>(params: {
    step: string;
    action: () => Promise<T> | T;
    timeoutMs?: number;
    continueOnError?: boolean;
    warnMessage?: string;
    failureLabel?: string;
  }): Promise<T | undefined> => {
    try {
      return typeof params.timeoutMs === "number"
        ? await runDeleteStepWithTimeout({
            step: params.step,
            timeoutMs: params.timeoutMs,
            action: params.action,
          })
        : await params.action();
    } catch (error) {
      if (params.warnMessage) {
        args.log.warn({ error, cellId: args.cell.id }, params.warnMessage);
      }

      if (params.failureLabel) {
        throw await onFailure(params.failureLabel, error);
      }
      if (!params.continueOnError) {
        throw error;
      }
      return;
    }
  };

  await runStep({
    step: "close_agent_session",
    action: () => args.closeSession(args.cell.id),
    timeoutMs: DELETE_CLOSE_AGENT_SESSION_TIMEOUT_MS,
    continueOnError: true,
    warnMessage: "Failed to close agent session before cell removal",
  });

  await runStep({
    step: "close_terminal_sessions",
    action: () => {
      args.closeTerminalSession(args.cell.id);
      args.closeChatTerminalSession?.(args.cell.id);
      args.clearSetupTerminal(args.cell.id);
    },
    timeoutMs: DELETE_CLOSE_TERMINALS_TIMEOUT_MS,
    continueOnError: true,
    warnMessage: "Failed to close terminal sessions before cell removal",
  });

  await runStep({
    step: "stop_services",
    action: () => args.stopCellServices(args.cell.id, { releasePorts: true }),
    failureLabel: "Service stop",
  });

  if (args.cell.deletionPhase !== "teardown_complete") {
    await runStep({
      step: "template_teardown",
      action: async () => {
        await args.runCellTeardown({ cell: args.cell, reason: "delete" });
        await markCellTeardownComplete({
          database: args.database,
          cell: args.cell,
        });
      },
      failureLabel: "Template teardown",
    });
  }

  await runStep({
    step: "remove_runtime_directory",
    action: () =>
      (args.removeRuntimeDirectory ?? removeCellRuntimeDir)(args.cell.id),
    timeoutMs: DELETE_REMOVE_RUNTIME_TIMEOUT_MS,
  });

  await runStep({
    step: "remove_workspace",
    action: async () => {
      const worktreeService = await args.getWorktreeService(
        args.cell.workspaceId
      );
      await removeCellWorkspace(worktreeService, args.cell, args.log);
    },
    timeoutMs: DELETE_REMOVE_WORKSPACE_TIMEOUT_MS,
    continueOnError: true,
    warnMessage: "Failed to remove cell workspace during deletion",
  });

  await runStep({
    step: "delete_cell_record",
    action: () => args.database.delete(cells).where(eq(cells.id, args.cell.id)),
    timeoutMs: DELETE_REMOVE_RECORD_TIMEOUT_MS,
  });
}

export async function deleteCellWithLifecycle(
  args: DeleteLifecycleArgs
): Promise<void> {
  await runWithCellCleanupLock(args.cell.id, async () => {
    const currentCell = await loadCellById(args.database, args.cell.id);
    if (!currentCell) {
      return;
    }

    await deleteCellWithLifecycleUnlocked({ ...args, cell: currentCell });
  });
}

async function deleteCellWithLifecycleUnlocked(
  args: DeleteLifecycleArgs
): Promise<void> {
  const previousStatus = args.cell.status as CellStatus;
  let lifecycleFailurePersisted = false;

  if (previousStatus !== "deleting") {
    await markCellDeletionStarted({
      database: args.database,
      cellId: args.cell.id,
      workspaceId: args.cell.workspaceId,
    });
  }

  const persistLifecycleFailure = async (label: string, error: unknown) => {
    lifecycleFailurePersisted = true;
    return await markCellDeletionFailure({
      database: args.database,
      cellId: args.cell.id,
      workspaceId: args.cell.workspaceId,
      error,
      label,
      status: args.cell.deletionPhase ? "deleting" : "error",
    });
  };

  try {
    await deleteCellWithTiming(args, persistLifecycleFailure);
  } catch (error) {
    if (args.cell.deletionPhase) {
      if (!lifecycleFailurePersisted) {
        await keepCellDeletionInProgress({
          database: args.database,
          cell: args.cell,
          error,
        });
      }
      throw error;
    }
    if (lifecycleFailurePersisted) {
      throw error;
    }
    const restoreStatus =
      previousStatus === "deleting" ? "error" : previousStatus;
    await restoreCellStatusAfterDeleteFailure({
      database: args.database,
      cellId: args.cell.id,
      workspaceId: args.cell.workspaceId,
      previousStatus: restoreStatus,
    });

    throw error;
  }
}
