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
import { constructs } from "../schema/constructs";
import { getWorkspaceRegistry, registerWorkspace } from "./registry";
import { removeWorkspaceCascade } from "./removal";

const SYNTHETIC_CONFIG_CONTENT = "export default {}";

async function createWorkspaceRoot(prefix = "workspace-removal-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "synthetic.config.ts"), SYNTHETIC_CONFIG_CONTENT);
  return dir;
}

describe("removeWorkspaceCascade", () => {
  let syntheticHome: string;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    syntheticHome = await mkdtemp(join(tmpdir(), "synthetic-home-removal-"));
    process.env.SYNTHETIC_HOME = syntheticHome;
    await testDb.delete(constructs);
  });

  afterEach(async () => {
    await rm(syntheticHome, { recursive: true, force: true });
    process.env.SYNTHETIC_HOME = undefined;
  });

  it("removes constructs and the workspace registry entry", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const workspace = await registerWorkspace(
      { path: workspaceRoot },
      { setActive: true }
    );

    const constructId = "construct-removal-test";
    const constructPath = join(
      workspaceRoot,
      ".synthetic",
      "constructs",
      constructId
    );
    await mkdir(constructPath, { recursive: true });

    await testDb.insert(constructs).values({
      id: constructId,
      name: "Removal fixture",
      templateId: "template-a",
      workspaceId: workspace.id,
      workspaceRootPath: workspaceRoot,
      workspacePath: constructPath,
      createdAt: new Date(),
      status: "ready",
      description: null,
      branchName: null,
      baseCommit: null,
    });

    const stopConstructServices = vi.fn().mockResolvedValue(undefined);
    const closeAgentSession = vi.fn().mockResolvedValue(undefined);

    const result = await removeWorkspaceCascade(workspace.id, {
      db: testDb,
      stopConstructServices,
      closeAgentSession,
    });

    expect(result).not.toBeNull();
    expect(result?.workspace.id).toBe(workspace.id);
    expect(result?.deletedConstructIds).toEqual([constructId]);

    const remainingConstructs = await testDb
      .select()
      .from(constructs)
      .where(eq(constructs.workspaceId, workspace.id));
    expect(remainingConstructs).toHaveLength(0);

    const registry = await getWorkspaceRegistry();
    expect(registry.workspaces).toHaveLength(0);

    expect(stopConstructServices).toHaveBeenCalledWith(constructId, {
      releasePorts: true,
    });
    expect(closeAgentSession).toHaveBeenCalledWith(constructId);
  });

  it("returns null when the workspace does not exist", async () => {
    const result = await removeWorkspaceCascade("missing", { db: testDb });
    expect(result).toBeNull();
  });
});
