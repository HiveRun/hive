import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
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
import type { AgentRuntimeService } from "../agents/service";
import type { LoggerService as Logger } from "../logger";
import { cells } from "../schema/cells";
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

type RemovalTestOverrides = {
  stopCellServices?: (
    cellId: string,
    options?: { releasePorts?: boolean }
  ) => Promise<void>;
  closeAgentSession?: (cellId: string) => Promise<void>;
  removeWorktree?: (workspacePath: string, cellId: string) => Promise<void>;
  logger?: Logger;
};

describe("removeWorkspaceCascade", () => {
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

    const result = await runRemoval(workspace, {
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

    await runRemoval(workspace, {
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

const runRemoval = (
  workspace: WorkspaceRecord,
  overrides: RemovalTestOverrides
) => {
  const supervisor = createTestSupervisor(overrides.stopCellServices);
  const agentRuntime = createTestAgentRuntime(overrides.closeAgentSession);
  const logger = overrides.logger ?? createTestLogger().logger;
  const worktreeManager = createTestWorktreeManager(overrides.removeWorktree);

  return removeWorkspaceCascade(workspace.id, {
    db: testDb,
    logger,
    supervisor,
    agentRuntime,
    worktreeManager,
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
  ) => Promise<void> = () => Promise.resolve()
): ServiceSupervisorService => ({
  bootstrap: () => Promise.resolve(),
  ensureCellServices: () => Promise.resolve(),
  startCellService: () => Promise.resolve(),
  startCellServices: () => Promise.resolve(),
  stopCellService: () => Promise.resolve(),
  stopCellServices,
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
  clearSetupTerminal: () => 0,
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
