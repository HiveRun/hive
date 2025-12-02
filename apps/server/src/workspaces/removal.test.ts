import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setupTestDb, testDb } from "../__tests__/test-db";
import {
  type AgentRuntimeService,
  AgentRuntimeServiceTag,
} from "../agents/service";
import { HiveConfigService } from "../config/context";
import type { HiveConfig } from "../config/schema";
import { DatabaseService } from "../db";
import { type LoggerService as Logger, LoggerService } from "../logger";
import { cells } from "../schema/cells";
import {
  type ServiceSupervisorService,
  ServiceSupervisorService as ServiceSupervisorServiceTag,
} from "../services/supervisor";
import {
  type WorktreeManagerService,
  WorktreeManagerServiceTag,
} from "../worktree/manager";
import {
  getWorkspaceRegistry,
  registerWorkspace,
  WorkspaceRegistryLayer,
} from "./registry";
import { removeWorkspaceCascadeEffect } from "./removal";

const HIVE_CONFIG_CONTENT = "export default {}";

type RemovalTestOverrides = {
  stopCellServices?: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void>;
  closeAgentSession?: (cellId: string) => Promise<void>;
  removeWorktree?: (workspacePath: string, cellId: string) => Promise<void>;
  logger?: Logger;
};

describe("removeWorkspaceCascadeEffect", () => {
  let hiveHome: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    hiveHome = await mkdtemp(join(tmpdir(), "hive-home-removal-"));
    process.env.HIVE_HOME = hiveHome;
    await testDb.delete(cells);
  });

  afterEach(async () => {
    await rm(hiveHome, { recursive: true, force: true });
    process.env.HIVE_HOME = undefined;
  });

  it("removes cells, services, sessions, and registry entry", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const workspace = await registerWorkspace(
      { path: workspaceRoot },
      { setActive: true }
    );

    const cellId = "cell-removal-test";
    const cellPath = join(workspaceRoot, ".hive", "cells", cellId);
    await mkdir(cellPath, { recursive: true });

    await testDb.insert(cells).values({
      id: cellId,
      name: "Removal fixture",
      templateId: "template-a",
      workspaceId: workspace.id,
      workspaceRootPath: workspaceRoot,
      workspacePath: cellPath,
      createdAt: new Date(),
      status: "ready",
      description: null,
      branchName: null,
      baseCommit: null,
    });

    const stopCellServices = vi.fn().mockResolvedValue(undefined);
    const closeAgentSession = vi.fn().mockResolvedValue(undefined);
    const { logger } = createTestLogger();

    const result = await runRemoval(workspace.id, {
      stopCellServices,
      closeAgentSession,
      logger,
    });

    expect(result).not.toBeNull();
    expect(result?.workspace.id).toBe(workspace.id);
    expect(result?.deletedCellIds).toEqual([cellId]);

    const remainingCells = await testDb
      .select()
      .from(cells)
      .where(eq(cells.workspaceId, workspace.id));
    expect(remainingCells).toHaveLength(0);

    const registry = await getWorkspaceRegistry();
    expect(registry.workspaces).toHaveLength(0);

    expect(stopCellServices).toHaveBeenCalledWith(cellId, {
      releasePorts: true,
    });
    expect(closeAgentSession).toHaveBeenCalledWith(cellId);
  });

  it("falls back to filesystem removal without warning", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const workspace = await registerWorkspace(
      { path: workspaceRoot },
      { setActive: true }
    );

    const cellId = "cell-removal-fallback";
    const cellPath = join(workspaceRoot, ".hive", "cells", cellId);
    await mkdir(cellPath, { recursive: true });

    await testDb.insert(cells).values({
      id: cellId,
      name: "Removal fallback",
      templateId: "template-a",
      workspaceId: workspace.id,
      workspaceRootPath: workspaceRoot,
      workspacePath: cellPath,
      createdAt: new Date(),
      status: "ready",
      description: null,
      branchName: null,
      baseCommit: null,
    });

    const stopCellServices = vi.fn().mockResolvedValue(undefined);
    const closeAgentSession = vi.fn().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn()
      .mockRejectedValue(new Error("git removal failed"));
    const { logger, warn } = createTestLogger();

    await runRemoval(workspace.id, {
      stopCellServices,
      closeAgentSession,
      removeWorktree,
      logger,
    });

    await expect(access(cellPath)).rejects.toThrow();
    expect(removeWorktree).toHaveBeenCalledWith(workspaceRoot, cellId);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null when the workspace does not exist", async () => {
    const { logger } = createTestLogger();

    const result = await runRemoval("missing", { logger });

    expect(result).toBeNull();
  });
});

async function createWorkspaceRoot(prefix = "workspace-removal-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "hive.config.ts"), HIVE_CONFIG_CONTENT);
  return dir;
}

const runRemoval = (workspaceId: string, overrides: RemovalTestOverrides) => {
  const supervisor = createTestSupervisor(overrides.stopCellServices);
  const agentRuntime = createTestAgentRuntime(overrides.closeAgentSession);
  const logger = overrides.logger ?? createTestLogger().logger;
  const worktreeManager = createTestWorktreeManager(overrides.removeWorktree);
  const hiveConfigService = createTestHiveConfigService();

  return Effect.runPromise(
    removeWorkspaceCascadeEffect(workspaceId).pipe(
      Effect.provideService(DatabaseService, { db: testDb }),
      Effect.provideService(ServiceSupervisorServiceTag, supervisor),
      Effect.provideService(AgentRuntimeServiceTag, agentRuntime),
      Effect.provideService(LoggerService, logger),
      Effect.provideService(WorktreeManagerServiceTag, worktreeManager),
      Effect.provideService(HiveConfigService, hiveConfigService),
      Effect.provide(WorkspaceRegistryLayer),
      Effect.scoped
    )
  );
};

const createTestSupervisor = (
  stopCellServices: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void> = () => Promise.resolve()
): ServiceSupervisorService => {
  const notImplemented = () => Effect.succeed(undefined);
  const stopCellServicesEffect: ServiceSupervisorService["stopCellServices"] = (
    cellId,
    options
  ) =>
    Effect.tryPromise({
      try: () => stopCellServices(cellId, options),
      catch: (cause) => ({ _tag: "ServiceSupervisorError" as const, cause }),
    });

  return {
    bootstrap: notImplemented(),
    ensureCellServices: () => notImplemented(),
    startCellService: () => notImplemented(),
    stopCellService: () => notImplemented(),
    stopCellServices: stopCellServicesEffect,
    stopAll: notImplemented(),
  };
};

const createTestAgentRuntime = (
  closeAgentSession: (cellId: string) => Promise<void> = () => Promise.resolve()
): AgentRuntimeService => {
  const runtimeError = (cause?: unknown) => ({
    _tag: "AgentRuntimeError" as const,
    cause,
  });
  const unsupported = () => Effect.fail(runtimeError(new Error("Not used")));

  return {
    ensureAgentSession: () => unsupported(),
    fetchAgentSession: () => unsupported(),
    fetchAgentSessionForCell: () => unsupported(),
    fetchAgentMessages: () => unsupported(),
    updateAgentSessionModel: () => unsupported(),
    sendAgentMessage: () => unsupported(),
    interruptAgentSession: () => unsupported(),
    stopAgentSession: () => unsupported(),
    closeAgentSession: (cellId) =>
      Effect.tryPromise({
        try: () => closeAgentSession(cellId),
        catch: (cause) => runtimeError(cause),
      }),
    closeAllAgentSessions: Effect.succeed(undefined),
    respondAgentPermission: () => unsupported(),
    fetchProviderCatalogForWorkspace: () => unsupported(),
  } satisfies AgentRuntimeService;
};

const createTestWorktreeManager = (
  removeWorktree: (
    workspacePath: string,
    cellId: string
  ) => Promise<void> = () => Promise.resolve()
): WorktreeManagerService => ({
  createManager: () =>
    Effect.fail({
      _tag: "WorktreeManagerInitError" as const,
      workspacePath: "",
      cause: new Error("Not implemented"),
    }),
  createWorktree: () =>
    Effect.fail({
      kind: "unknown",
      message: "Not implemented",
    }),
  removeWorktree: (workspacePath, cellId) =>
    Effect.tryPromise({
      try: () => removeWorktree(workspacePath, cellId),
      catch: (cause) => ({
        kind: "cleanup",
        message: "removeWorktree failed",
        context: { workspacePath, cellId },
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      }),
    }),
});

const createTestHiveConfigService = (): HiveConfigService => ({
  workspaceRoot: "",
  resolve: () => "",
  load: () => Effect.succeed({} as HiveConfig),
  clear: () =>
    Effect.sync(() => {
      /* no-op for tests */
    }),
});

const createTestLogger = () => {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();

  const wrap =
    (fn: typeof debug): Logger["debug"] =>
    (message, context) =>
      Effect.sync(() => fn(message, context));

  const logger: Logger = {
    debug: wrap(debug),
    info: wrap(info),
    warn: wrap(warn),
    error: wrap(error),
    child: () => logger,
  };

  return { logger, debug, info, warn, error };
};
