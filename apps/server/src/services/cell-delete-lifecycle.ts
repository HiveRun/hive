import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { eq } from "drizzle-orm";

import type { DatabaseService as DatabaseServiceType } from "../db";
import { type CellStatus, cells } from "../schema/cells";
import type {
  CellTimingStatus,
  CellTimingWorkflow,
} from "../schema/timing-events";
import {
  type AsyncWorktreeManager,
  describeWorktreeError,
  type WorktreeManagerError,
} from "../worktree/manager";
import { emitCellStatusUpdate } from "./events";

type DatabaseClient = DatabaseServiceType["db"];

type DeleteLifecycleLogger = {
  info?: (obj: Record<string, unknown>, message?: string) => void;
  warn: (obj: Record<string, unknown>, message?: string) => void;
  error: (obj: Record<string, unknown> | Error, message?: string) => void;
};

type CellDeleteRecord = Pick<
  typeof cells.$inferSelect,
  "id" | "name" | "templateId" | "workspaceId" | "workspacePath" | "status"
>;

type CellWorkspaceRecord = Pick<
  typeof cells.$inferSelect,
  "id" | "workspacePath"
>;

type DeleteTimingEventArgs = {
  database: DatabaseClient;
  log: DeleteLifecycleLogger;
  cellId: string;
  cellName?: string | null;
  workflow: CellTimingWorkflow;
  runId: string;
  step: string;
  status: CellTimingStatus;
  durationMs: number;
  error?: string | null;
  templateId?: string | null;
  workspaceId?: string | null;
};

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
  getWorktreeService: (workspaceId: string) => Promise<AsyncWorktreeManager>;
  log: DeleteLifecycleLogger;
  recordTimingEvent: (args: DeleteTimingEventArgs) => Promise<void>;
};

const DELETE_CLOSE_AGENT_SESSION_TIMEOUT_MS = 15_000;
const DELETE_CLOSE_TERMINALS_TIMEOUT_MS = 5000;
const DELETE_STOP_SERVICES_TIMEOUT_MS = 30_000;
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

async function deleteCellWithTiming(args: DeleteLifecycleArgs) {
  const runId = randomUUID();
  const deleteStartedAt = Date.now();

  const runStep = async <T>(params: {
    step: string;
    action: () => Promise<T> | T;
    timeoutMs?: number;
    continueOnError?: boolean;
    warnMessage?: string;
  }): Promise<T | undefined> => {
    const startedAt = Date.now();
    let status: CellTimingStatus = "ok";
    let errorMessage: string | null = null;

    try {
      return typeof params.timeoutMs === "number"
        ? await runDeleteStepWithTimeout({
            step: params.step,
            timeoutMs: params.timeoutMs,
            action: params.action,
          })
        : await params.action();
    } catch (error) {
      status = "error";
      errorMessage = error instanceof Error ? error.message : String(error);

      if (params.warnMessage) {
        args.log.warn({ error, cellId: args.cell.id }, params.warnMessage);
      }

      if (!params.continueOnError) {
        throw error;
      }
      return;
    } finally {
      const durationMs = Date.now() - startedAt;
      await args.recordTimingEvent({
        database: args.database,
        log: args.log,
        cellId: args.cell.id,
        workflow: "delete",
        runId,
        step: params.step,
        status,
        durationMs,
        error: errorMessage,
        cellName: args.cell.name,
        templateId: args.cell.templateId,
        workspaceId: args.cell.workspaceId,
      });
    }
  };

  try {
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
      timeoutMs: DELETE_STOP_SERVICES_TIMEOUT_MS,
      continueOnError: true,
      warnMessage: "Failed to stop services before cell removal",
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
      action: () =>
        args.database.delete(cells).where(eq(cells.id, args.cell.id)),
      timeoutMs: DELETE_REMOVE_RECORD_TIMEOUT_MS,
    });

    await args.recordTimingEvent({
      database: args.database,
      log: args.log,
      cellId: args.cell.id,
      workflow: "delete",
      runId,
      step: "total",
      status: "ok",
      durationMs: Date.now() - deleteStartedAt,
      cellName: args.cell.name,
      templateId: args.cell.templateId,
      workspaceId: args.cell.workspaceId,
    });
  } catch (error) {
    const totalDurationMs = Date.now() - deleteStartedAt;
    const totalError = error instanceof Error ? error.message : String(error);
    await args.recordTimingEvent({
      database: args.database,
      log: args.log,
      cellId: args.cell.id,
      workflow: "delete",
      runId,
      step: "total",
      status: "error",
      durationMs: totalDurationMs,
      error: totalError,
      cellName: args.cell.name,
      templateId: args.cell.templateId,
      workspaceId: args.cell.workspaceId,
    });

    throw error;
  }
}

export async function deleteCellWithLifecycle(
  args: DeleteLifecycleArgs
): Promise<void> {
  const previousStatus = args.cell.status as CellStatus;

  if (previousStatus !== "deleting") {
    await markCellDeletionStarted({
      database: args.database,
      cellId: args.cell.id,
      workspaceId: args.cell.workspaceId,
    });
  }

  try {
    await deleteCellWithTiming(args);
  } catch (error) {
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
