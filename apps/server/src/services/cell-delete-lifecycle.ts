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
import { emitCellStatusUpdate } from "./events";
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
  return new Promise((resolve, reject) => {
    let completed = false;
    const actionPromise = Promise.resolve().then(args.action);
    const timeoutError = new Error(
      `Delete step '${args.step}' timed out after ${args.timeoutMs}ms`
    );

    const timer = setTimeout(() => {
      if (completed) {
        return;
      }

      completed = true;
      reject(timeoutError);
    }, args.timeoutMs);

    actionPromise.then(
      (result) => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function markCellDeletionStarted(args: {
  database: DatabaseClient;
  cellId: string;
  workspaceId: string;
}) {
  await args.database
    .update(cells)
    .set({ status: "deleting" })
    .where(eq(cells.id, args.cellId));
  emitCellStatusUpdate({
    cellId: args.cellId,
    workspaceId: args.workspaceId,
    status: "deleting",
    lastSetupError: undefined,
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

  await args.database
    .update(cells)
    .set({ status: args.previousStatus })
    .where(eq(cells.id, args.cellId));
  emitCellStatusUpdate({
    cellId: args.cellId,
    workspaceId: args.workspaceId,
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
}): Promise<Error> {
  const reason = formatLifecycleError(args.error);
  const lastSetupError = `${args.label} failed during cell deletion: ${reason}`;
  await args.database
    .update(cells)
    .set({ status: "error", lastSetupError })
    .where(eq(cells.id, args.cellId));
  emitCellStatusUpdate({
    cellId: args.cellId,
    workspaceId: args.workspaceId,
    status: "error",
    lastSetupError,
  });
  return new Error(lastSetupError);
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
  onStopFailure: (error: unknown) => Promise<Error>,
  onTeardownFailure: (error: unknown) => Promise<Error>
) {
  const runStep = async <T>(params: {
    step: string;
    action: () => Promise<T> | T;
    timeoutMs?: number;
    continueOnError?: boolean;
    warnMessage?: string;
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

  try {
    await runStep({
      step: "stop_services",
      action: () => args.stopCellServices(args.cell.id, { releasePorts: true }),
    });
  } catch (error) {
    throw await onStopFailure(error);
  }

  try {
    await runStep({
      step: "template_teardown",
      action: () => args.runCellTeardown({ cell: args.cell, reason: "delete" }),
    });
  } catch (error) {
    throw await onTeardownFailure(error);
  }

  await runStep({
    step: "remove_runtime_directory",
    action: () => removeCellRuntimeDir(args.cell.id),
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

  const persistLifecycleFailure = (label: string) => async (error: unknown) => {
    lifecycleFailurePersisted = true;
    return await markCellDeletionFailure({
      database: args.database,
      cellId: args.cell.id,
      workspaceId: args.cell.workspaceId,
      error,
      label,
    });
  };

  try {
    await deleteCellWithTiming(
      args,
      persistLifecycleFailure("Service stop"),
      persistLifecycleFailure("Template teardown")
    );
  } catch (error) {
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
