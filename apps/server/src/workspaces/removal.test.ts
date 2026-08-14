import {
  access as accessPath,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  afterEach as cleanupAfterEach,
  describe,
  expect,
  it,
  beforeEach as resetRemovalBeforeEach,
  beforeAll as setupDatabaseBeforeAll,
  vi,
} from "vitest";
import {
  createBlockedServiceStop,
  createResolvedCleanupMocks,
} from "../__tests__/routes/cells-route-test-helpers";
import { setupTestDb, testDb } from "../__tests__/test-db";
import type { AgentRuntimeService } from "../agents/service";
import type { LoggerService as Logger } from "../logger";
import { cells } from "../schema/cells";
import { linearIntegrations } from "../schema/linear-integrations";
import { deleteCellWithLifecycle } from "../services/cell-delete-lifecycle";
import { ensureCellEnvironment } from "../services/cell-environment";
import type { ServiceSupervisorService } from "../services/supervisor";
import type { WorktreeManagerService } from "../worktree/manager";
import {
  getWorkspaceRegistry,
  registerWorkspace,
  removeWorkspace,
  type WorkspaceRecord,
} from "./registry";
import { removeWorkspaceCascade } from "./removal";

const HIVE_CONFIG_CONTENT = "{}";

const loadRemovalCell = async (cellId: string) => {
  const [cell] = await testDb.select().from(cells).where(eq(cells.id, cellId));
  return cell;
};

type RemovalTestOverrides = {
  stopCellServices?: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void>;
  closeAgentSession?: (cellId: string) => Promise<void>;
  removeWorktree?: (workspacePath: string, cellId: string) => Promise<void>;
  runCellTeardown?: ServiceSupervisorService["runCellTeardown"];
  clearSetupTerminal?: (cellId: string) => void;
  closeTerminalSession?: (cellId: string) => void;
  closeChatTerminalSession?: (cellId: string) => void;
  logger?: Logger;
};

type RemovalCellFixture = {
  cellId: string;
  cellPath: string;
};

describe("removeWorkspaceCascade", () => {
  let hiveHome: string;

  setupDatabaseBeforeAll(async () => {
    await setupTestDb();
  });

  resetRemovalBeforeEach(async () => {
    hiveHome = await mkdtemp(join(tmpdir(), "hive-home-removal-"));
    process.env.HIVE_HOME = hiveHome;
    await testDb.delete(cells);
    await testDb.delete(linearIntegrations);
  });

  cleanupAfterEach(async () => {
    await rm(hiveHome, { recursive: true, force: true });
    process.env.HIVE_HOME = undefined;
  });

  it("removes cells, services, sessions, and registry entry", async () => {
    const { workspace, cellId, cellPath } = await createWorkspaceWithCell({
      cellId: "cell-removal-test",
      name: "Removal fixture",
    });

    await testDb.insert(linearIntegrations).values({
      workspaceId: workspace.id,
      accessToken: "enc-access",
      refreshToken: "enc-refresh",
      accessTokenExpiresAt: new Date(),
      tokenType: "Bearer",
      scope: "read",
      linearUserId: "linear-user-1",
      linearUserName: "Linear User",
      linearUserEmail: "linear@example.com",
      linearOrganizationId: "linear-org-1",
      linearOrganizationName: "Linear Org",
      teamId: "linear-team-1",
      teamKey: "ENG",
      teamName: "Engineering",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const environment = ensureCellEnvironment(cellId, cellPath);
    await writeFile(
      join(environment.HIVE_CELL_RUNTIME_DIR, "runtime.txt"),
      "x"
    );
    await writeFile(
      join(environment.HIVE_CELL_ARTIFACTS_DIR, "artifact.txt"),
      "x"
    );
    const order: string[] = [];
    const stopCellServices = vi.fn(async () => {
      order.push("stop");
      const [deletingCell] = await testDb
        .select()
        .from(cells)
        .where(eq(cells.id, cellId));
      expect(deletingCell?.status).toBe("deleting");
    });
    const closeAgentSession = vi.fn(() => {
      order.push("agent");
      return Promise.resolve();
    });
    const closeTerminalSession = vi.fn(() => order.push("terminal"));
    const closeChatTerminalSession = vi.fn(() => order.push("chat"));
    const clearSetupTerminal = vi.fn(() => order.push("setup"));
    const runCellTeardown = vi.fn(() => {
      order.push("teardown");
      return Promise.resolve();
    });
    const removeWorktree = vi.fn(async () => {
      order.push("worktree");
      await expect(
        accessPath(environment.HIVE_CELL_RUNTIME_DIR)
      ).rejects.toThrow();
      await accessPath(environment.HIVE_CELL_ARTIFACTS_DIR);
    });
    const { logger } = createTestLogger();

    const result = await runRemoval(workspace, {
      stopCellServices,
      closeAgentSession,
      closeTerminalSession,
      closeChatTerminalSession,
      clearSetupTerminal,
      runCellTeardown,
      removeWorktree,
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

    const remainingIntegrations = await testDb
      .select()
      .from(linearIntegrations)
      .where(eq(linearIntegrations.workspaceId, workspace.id));
    expect(remainingIntegrations).toHaveLength(0);

    const registry = await getWorkspaceRegistry();
    expect(registry.workspaces).toHaveLength(0);

    expect(stopCellServices).toHaveBeenCalledWith(cellId, {
      releasePorts: true,
    });
    expect(closeAgentSession).toHaveBeenCalledWith(cellId);
    expect(closeTerminalSession).toHaveBeenCalledWith(cellId);
    expect(closeChatTerminalSession).toHaveBeenCalledWith(cellId);
    expect(clearSetupTerminal).toHaveBeenCalledWith(cellId);
    expect(order).toEqual([
      "agent",
      "terminal",
      "chat",
      "setup",
      "stop",
      "teardown",
      "worktree",
    ]);
    await expect(
      accessPath(environment.HIVE_CELL_RUNTIME_DIR)
    ).rejects.toThrow();
    await accessPath(environment.HIVE_CELL_ARTIFACTS_DIR);
  });

  it("retains the workspace and cell when template teardown fails", async () => {
    const { workspace, cellId, cellPath } = await createWorkspaceWithCell({
      cellId: "cell-removal-teardown-failure",
      name: "Removal teardown failure",
    });
    const runCellTeardown = vi
      .fn<ServiceSupervisorService["runCellTeardown"]>()
      .mockRejectedValue(new Error("cleanup unavailable"));

    await expect(runRemoval(workspace, { runCellTeardown })).rejects.toThrow(
      "cleanup unavailable"
    );

    const retained = await loadRemovalCell(cellId);
    expect(retained?.status).toBe("error");
    expect(retained?.lastSetupError).toContain("cleanup unavailable");
    await accessPath(cellPath);
    expect((await getWorkspaceRegistry()).workspaces).toHaveLength(1);
  });

  it("blocks teardown and keeps the workspace retryable when service stop fails", async () => {
    const { workspace, cellId, cellPath } = await createWorkspaceWithCell({
      cellId: "cell-removal-stop-failure",
      name: "Removal stop failure",
    });
    const { runCellTeardown, removeWorktree } = createResolvedCleanupMocks();

    await expect(
      runRemoval(workspace, {
        stopCellServices: () => Promise.reject(new Error("stop timed out")),
        runCellTeardown,
        removeWorktree,
      })
    ).rejects.toThrow("Service stop failed during cell deletion");

    expect(runCellTeardown).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    const retained = await loadRemovalCell(cellId);
    expect(retained?.status).toBe("error");
    expect(retained?.lastSetupError).toContain("stop timed out");
    await accessPath(cellPath);
  });

  it("does not mark later cells deleting when an earlier cleanup fails", async () => {
    const { workspace, workspaceRoot, cellId } = await createWorkspaceWithCell({
      cellId: "cell-cascade-first",
      name: "Cascade first",
    });
    const secondCellId = "cell-cascade-second";
    const secondCellPath = join(workspaceRoot, ".hive", "cells", secondCellId);
    await mkdir(secondCellPath, { recursive: true });
    await testDb.insert(cells).values({
      id: secondCellId,
      name: "Cascade second",
      templateId: "template-a",
      workspaceId: workspace.id,
      workspaceRootPath: workspaceRoot,
      workspacePath: secondCellPath,
      createdAt: new Date(),
      status: "spawning",
      description: null,
      branchName: null,
      baseCommit: null,
    });
    const originalStatuses = new Map([
      [cellId, "ready"],
      [secondCellId, "spawning"],
    ]);
    const stopCellServices = vi.fn((cellIdToStop: string) =>
      Promise.reject(new Error(`stop failed for ${cellIdToStop}`))
    );

    await expect(runRemoval(workspace, { stopCellServices })).rejects.toThrow(
      "Service stop failed during cell deletion"
    );

    expect(stopCellServices).toHaveBeenCalledOnce();
    const attemptedCellId = stopCellServices.mock.calls[0]?.[0];
    if (!attemptedCellId) {
      throw new Error("Expected one attempted cell cleanup");
    }
    const untouchedCellId = attemptedCellId === cellId ? secondCellId : cellId;
    const remaining = await testDb
      .select()
      .from(cells)
      .where(eq(cells.workspaceId, workspace.id));
    expect(remaining.find((cell) => cell.id === attemptedCellId)?.status).toBe(
      "error"
    );
    expect(remaining.find((cell) => cell.id === untouchedCellId)?.status).toBe(
      originalStatuses.get(untouchedCellId)
    );
    expect(remaining.some((cell) => cell.status === "deleting")).toBe(false);
  });

  it("serializes workspace cascade and direct cleanup for the same cell", async () => {
    const { workspace, cellId } = await createWorkspaceWithCell({
      cellId: "cell-concurrent-removal",
      name: "Concurrent removal",
    });
    const cell = await loadRemovalCell(cellId);
    if (!cell) {
      throw new Error("Expected removal cell");
    }
    const blockedStop = createBlockedServiceStop();
    const stopCellServices = blockedStop.stop;
    const { runCellTeardown, removeWorktree } = createResolvedCleanupMocks();
    const cascade = runRemoval(workspace, {
      stopCellServices,
      runCellTeardown,
      removeWorktree,
    });
    await blockedStop.started.promise;
    const direct = deleteCellWithLifecycle({
      database: testDb,
      cell,
      closeSession: () => Promise.resolve(),
      closeTerminalSession: () => 0,
      closeChatTerminalSession: () => 0,
      clearSetupTerminal: () => 0,
      stopCellServices,
      runCellTeardown,
      getWorktreeService: async () => ({
        createWorktree: () => Promise.reject(new Error("Not used")),
        removeWorktree: () => removeWorktree(),
      }),
      log: {
        info: () => 0,
        warn: () => 0,
        error: () => 0,
      },
    });
    blockedStop.released.resolve();

    await Promise.all([cascade, direct]);
    expect(stopCellServices).toHaveBeenCalledOnce();
    expect(runCellTeardown).toHaveBeenCalledOnce();
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it("falls back to filesystem removal without warning", async () => {
    const { workspace, cellId, cellPath, workspaceRoot } =
      await createWorkspaceWithCell({
        cellId: "cell-removal-fallback",
        name: "Removal fallback",
      });

    const stopCellServices = vi.fn().mockResolvedValue(undefined);
    const closeAgentSession = vi.fn().mockResolvedValue(undefined);
    const removeWorktree = vi
      .fn()
      .mockRejectedValue(new Error("git removal failed"));
    const { logger, warn } = createTestLogger();

    await runRemoval(workspace, {
      stopCellServices,
      closeAgentSession,
      removeWorktree,
      logger,
    });

    await expect(accessPath(cellPath)).rejects.toThrow();
    expect(removeWorktree).toHaveBeenCalledWith(workspaceRoot, cellId);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns null when the workspace does not exist", async () => {
    const { logger } = createTestLogger();
    const result = await removeWorkspaceCascade("missing", {
      db: testDb,
      logger,
      supervisor: createTestSupervisor(),
      agentRuntime: createTestAgentRuntime(),
      worktreeManager: createTestWorktreeManager(),
      resolveWorkspaceContext: () => Promise.reject(new Error("missing")),
      removeWorkspace: () => Promise.resolve(false),
    }).catch(() => null);

    expect(result).toBeNull();
  });
});

async function createWorkspaceRoot(prefix = "workspace-removal-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "hive.config.json"), HIVE_CONFIG_CONTENT);
  return dir;
}

async function createWorkspaceWithCell(
  fixture: Omit<RemovalCellFixture, "cellPath"> & { name: string }
) {
  const workspaceRoot = await createWorkspaceRoot();
  const workspace = await registerWorkspace(
    { path: workspaceRoot },
    { setActive: true }
  );
  const cellPath = join(workspaceRoot, ".hive", "cells", fixture.cellId);

  await mkdir(cellPath, { recursive: true });
  await testDb.insert(cells).values({
    id: fixture.cellId,
    name: fixture.name,
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

  return { workspaceRoot, workspace, cellId: fixture.cellId, cellPath };
}

const runRemoval = (
  workspace: WorkspaceRecord,
  overrides: RemovalTestOverrides
) => {
  const supervisor = createTestSupervisor(
    overrides.stopCellServices,
    overrides.runCellTeardown,
    overrides.clearSetupTerminal
  );
  const agentRuntime = createTestAgentRuntime(overrides.closeAgentSession);
  const logger = overrides.logger ?? createTestLogger().logger;
  const worktreeManager = createTestWorktreeManager(overrides.removeWorktree);

  return removeWorkspaceCascade(workspace.id, {
    db: testDb,
    logger,
    supervisor,
    agentRuntime,
    worktreeManager,
    closeTerminalSession: overrides.closeTerminalSession ?? (() => 0),
    closeChatTerminalSession: overrides.closeChatTerminalSession ?? (() => 0),
    resolveWorkspaceContext: () =>
      Promise.resolve({
        workspace,
        loadConfig: async () => ({ promptSources: [], templates: {} }),
        createWorktreeManager: () =>
          Promise.reject(new Error("Not implemented")),
        createWorktree: () => Promise.reject(new Error("Not implemented")),
        removeWorktree: () => Promise.resolve(),
      }),
    removeWorkspace,
  });
};

const createTestSupervisor = (
  stopCellServices: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void> = () => Promise.resolve(),
  runCellTeardown: ServiceSupervisorService["runCellTeardown"] = () =>
    Promise.resolve(),
  clearSetupTerminal: (cellId: string) => void = () => 0
): ServiceSupervisorService => ({
  bootstrap: () => Promise.resolve(),
  ensureCellServices: () => Promise.resolve(),
  startCellService: () => Promise.resolve(),
  startCellServices: () => Promise.resolve(),
  stopCellService: () => Promise.resolve(),
  stopCellServices,
  runCellTeardown,
  stopAll: () => Promise.resolve(),
  getServiceTerminalSession: () => null,
  readServiceTerminalOutput: () => "",
  subscribeToServiceTerminal: () => () => 0,
  writeServiceTerminalInput: () => 0,
  resizeServiceTerminal: () => 0,
  clearServiceTerminal: () => 0,
  getSetupTerminalSession: () => null,
  readSetupTerminalOutput: () => "",
  subscribeToSetupTerminal: () => () => 0,
  writeSetupTerminalInput: () => 0,
  resizeSetupTerminal: () => 0,
  clearSetupTerminal,
});

const createTestAgentRuntime = (
  closeAgentSession: (cellId: string) => Promise<void> = () => Promise.resolve()
): AgentRuntimeService => {
  const unsupported = () => Promise.reject(new Error("Not used"));

  return {
    ensureAgentSession: unsupported,
    fetchAgentSession: unsupported,
    fetchAgentSessionForCell: unsupported,
    fetchAgentMessages: unsupported,
    fetchCompactionStats: unsupported,
    updateAgentSessionModel: unsupported,
    sendAgentMessage: unsupported,
    interruptAgentSession: unsupported,
    stopAgentSession: unsupported,
    closeAgentSession,
    closeAllAgentSessions: () => Promise.resolve(),
    respondAgentPermission: unsupported,
    fetchProviderCatalogForWorkspace: unsupported,
  };
};

const createTestWorktreeManager = (
  removeWorktree: (
    workspacePath: string,
    cellId: string
  ) => Promise<void> = () => Promise.resolve()
): WorktreeManagerService => ({
  createManager: () => Promise.reject(new Error("Not implemented")),
  createWorktree: () => Promise.reject(new Error("Not implemented")),
  removeWorktree,
});

const createTestLogger = () => {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();

  const logger: Logger = {
    debug,
    info,
    warn,
    error,
    child: () => logger,
  };

  return { logger, debug, info, warn, error };
};
