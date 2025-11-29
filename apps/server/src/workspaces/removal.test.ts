import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { cells } from "../schema/cells";
import { getWorkspaceRegistry, registerWorkspace } from "./registry";
import { removeWorkspaceCascade } from "./removal";

const HIVE_CONFIG_CONTENT = "export default {}";

async function createWorkspaceRoot(prefix = "workspace-removal-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "hive.config.ts"), HIVE_CONFIG_CONTENT);
  return dir;
}

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

  it("removes cells and the workspace registry entry", async () => {
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

    const result = await removeWorkspaceCascade(workspace.id, {
      db: testDb,
      stopCellServices,
      closeAgentSession,
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

  it("returns null when the workspace does not exist", async () => {
    const result = await removeWorkspaceCascade("missing", { db: testDb });
    expect(result).toBeNull();
  });
});
