import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { AgentRuntimeServiceTag } from "../agents/service";
import { DatabaseService } from "../db";
import { LoggerService } from "../logger";
import { runServerEffect } from "../runtime";
import { cells } from "../schema/cells";
import { ServiceSupervisorService } from "../services/supervisor";
import {
  type WorktreeManagerService,
  WorktreeManagerServiceTag,
} from "../worktree/manager";
import {
  resolveWorkspaceContextEffect,
  WorkspaceContextError,
  type WorkspaceRuntimeContext,
} from "./context";
import { removeWorkspaceEffect, type WorkspaceRecord } from "./registry";

export type WorkspaceRemovalResult = {
  workspace: WorkspaceRecord;
  deletedCellIds: string[];
};

type WorkspaceRemovalError = {
  readonly _tag: "WorkspaceRemovalError";
  readonly message: string;
  readonly cause?: unknown;
};

const makeWorkspaceRemovalError = (
  message: string,
  cause?: unknown
): WorkspaceRemovalError => ({
  _tag: "WorkspaceRemovalError",
  message,
  cause,
});

type WorkspaceCellRow = {
  id: string;
  workspacePath: string | null;
};

export const removeWorkspaceCascadeEffect = (workspaceId: string) =>
  Effect.gen(function* () {
    const logger = yield* LoggerService;
    const { db } = yield* DatabaseService;
    const supervisor = yield* ServiceSupervisorService;
    const agentRuntime = yield* AgentRuntimeServiceTag;
    const worktreeManager = yield* WorktreeManagerServiceTag;

    const context = yield* resolveWorkspaceContextEffect(workspaceId).pipe(
      Effect.catchIf(
        (error): error is WorkspaceContextError =>
          error instanceof WorkspaceContextError,
        () => Effect.succeed<WorkspaceRuntimeContext | null>(null)
      )
    );

    if (!context) {
      return null;
    }

    const workspaceCells = yield* fetchCellsForWorkspace(db, workspaceId);

    const deletedCellIds: string[] = [];

    for (const cell of workspaceCells) {
      yield* agentRuntime.closeAgentSession(cell.id).pipe(
        Effect.catchAll((cause) =>
          logWarning(logger, "Failed to close agent session", {
            cellId: cell.id,
            error: formatError(cause),
          })
        )
      );

      yield* supervisor.stopCellServices(cell.id, { releasePorts: true }).pipe(
        Effect.catchAll((cause) =>
          logWarning(logger, "Failed to stop cell services", {
            cellId: cell.id,
            error: formatError(cause),
          })
        )
      );

      yield* cleanupCellWorkspace({
        workspaceRootPath: context.workspace.path,
        cellWorkspacePath: cell.workspacePath,
        cellId: cell.id,
        worktreeManager,
        logger,
      });

      deletedCellIds.push(cell.id);
    }

    if (deletedCellIds.length > 0) {
      yield* deleteCellsForWorkspace(db, workspaceId);
    }

    yield* removeWorkspaceEffect(workspaceId).pipe(
      Effect.catchAll((cause) =>
        logWarning(logger, "Failed to remove workspace registry entry", {
          workspaceId,
          error: formatError(cause),
        })
      )
    );

    return { workspace: context.workspace, deletedCellIds };
  });

export function removeWorkspaceCascade(
  workspaceId: string
): Promise<WorkspaceRemovalResult | null> {
  return runServerEffect(removeWorkspaceCascadeEffect(workspaceId));
}

const fetchCellsForWorkspace = (
  database: typeof import("../db").db,
  workspaceId: string
) =>
  Effect.tryPromise<WorkspaceCellRow[], WorkspaceRemovalError>({
    try: () =>
      database
        .select({ id: cells.id, workspacePath: cells.workspacePath })
        .from(cells)
        .where(eq(cells.workspaceId, workspaceId)),
    catch: (cause) =>
      makeWorkspaceRemovalError("Failed to load cells for workspace", cause),
  });

const deleteCellsForWorkspace = (
  database: typeof import("../db").db,
  workspaceId: string
) =>
  Effect.tryPromise<unknown, WorkspaceRemovalError>({
    try: () => database.delete(cells).where(eq(cells.workspaceId, workspaceId)),
    catch: (cause) =>
      makeWorkspaceRemovalError("Failed to delete cells for workspace", cause),
  }).pipe(Effect.map(() => ({})));

type CleanupArgs = {
  workspaceRootPath: string;
  cellWorkspacePath: string | null;
  cellId: string;
  worktreeManager: WorktreeManagerService;
  logger: import("../logger").LoggerService;
};

const cleanupCellWorkspace = ({
  workspaceRootPath,
  cellWorkspacePath,
  cellId,
  worktreeManager,
  logger,
}: CleanupArgs) =>
  worktreeManager.removeWorktree(workspaceRootPath, cellId).pipe(
    Effect.catchAll((worktreeError) =>
      fallbackWorkspaceRemoval({
        cellWorkspacePath,
        cellId,
        worktreeError,
        logger,
      })
    )
  );

type FallbackArgs = {
  cellWorkspacePath: string | null;
  cellId: string;
  worktreeError: unknown;
  logger: import("../logger").LoggerService;
};

const fallbackWorkspaceRemoval = ({
  cellWorkspacePath,
  cellId,
  worktreeError,
  logger,
}: FallbackArgs) => {
  if (!cellWorkspacePath?.trim()) {
    return logWarning(
      logger,
      "Worktree removal failed with no workspace path",
      {
        cellId,
        error: formatError(worktreeError),
      }
    );
  }

  return Effect.tryPromise<unknown, WorkspaceRemovalError>({
    try: () => rm(cellWorkspacePath, { recursive: true, force: true }),
    catch: (cause) =>
      makeWorkspaceRemovalError("Failed to remove workspace directory", cause),
  }).pipe(
    Effect.tap(() =>
      logger.debug("Removed workspace directory after git cleanup failure", {
        cellId,
        workspacePath: cellWorkspacePath,
      })
    ),
    Effect.catchAll((fsError) =>
      logWarning(logger, "Failed to remove workspace directory", {
        cellId,
        workspacePath: cellWorkspacePath,
        worktreeError: formatError(worktreeError),
        error: formatError(fsError),
      })
    ),
    Effect.map(() => ({}))
  );
};

const logWarning = (
  logger: import("../logger").LoggerService,
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
