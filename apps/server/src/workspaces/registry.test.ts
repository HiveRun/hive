import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  activateWorkspace,
  getWorkspaceRegistry,
  listWorkspaces,
  registerWorkspace,
  removeWorkspace,
  updateWorkspaceLabel,
} from "./registry";

const WORKSPACE_FILE_CONTENT = "export default {}";

async function createWorkspaceRoot(prefix = "synthetic-workspace-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "synthetic.config.ts"), WORKSPACE_FILE_CONTENT);
  return dir;
}

describe("workspace registry", () => {
  let syntheticHome: string;

  beforeEach(async () => {
    syntheticHome = await mkdtemp(join(tmpdir(), "synthetic-home-"));
    process.env.SYNTHETIC_HOME = syntheticHome;
  });

  afterEach(async () => {
    await rm(syntheticHome, { recursive: true, force: true });
    process.env.SYNTHETIC_HOME = undefined;
  });

  test("registerWorkspace adds a new workspace and lists it", async () => {
    const workspaceDir = await createWorkspaceRoot();

    const workspace = await registerWorkspace(
      { path: workspaceDir },
      { setActive: true }
    );
    expect(workspace.path).toBe(workspaceDir);
    expect(workspace.label).toBe(basename(workspaceDir));
    expect(workspace.lastOpenedAt).toBeTruthy();

    const allWorkspaces = await listWorkspaces();
    expect(allWorkspaces).toHaveLength(1);
    const first = allWorkspaces[0];
    if (!first) {
      throw new Error("Workspace registry returned empty list");
    }
    expect(first.id).toBe(workspace.id);

    const registry = await getWorkspaceRegistry();
    expect(registry.activeWorkspaceId).toBe(workspace.id);
  });

  test("re-registering an existing workspace does not duplicate entries", async () => {
    const workspaceDir = await createWorkspaceRoot();

    const first = await registerWorkspace(
      { path: workspaceDir, label: "Primary" },
      { setActive: true }
    );
    const second = await registerWorkspace({ path: workspaceDir });

    expect(second.id).toBe(first.id);
    expect(second.label).toBe("Primary");

    const allWorkspaces = await listWorkspaces();
    expect(allWorkspaces).toHaveLength(1);
  });

  test("updating label and removing workspace", async () => {
    const workspaceDir = await createWorkspaceRoot();
    const workspace = await registerWorkspace({ path: workspaceDir });

    const updated = await updateWorkspaceLabel({
      id: workspace.id,
      label: "My Repo",
    });
    expect(updated?.label).toBe("My Repo");

    const activated = await activateWorkspace(workspace.id);
    expect(activated?.lastOpenedAt).toBeTruthy();

    const removed = await removeWorkspace(workspace.id);
    expect(removed).toBe(true);

    const allWorkspaces = await listWorkspaces();
    expect(allWorkspaces).toHaveLength(0);
  });

  test("activating and removing workspaces maintains active workspace id", async () => {
    const primaryDir = await createWorkspaceRoot("primary-workspace-");
    const secondaryDir = await createWorkspaceRoot("secondary-workspace-");

    const primary = await registerWorkspace(
      { path: primaryDir },
      { setActive: true }
    );
    const secondary = await registerWorkspace({ path: secondaryDir });

    let registry = await getWorkspaceRegistry();
    expect(registry.activeWorkspaceId).toBe(primary.id);

    await activateWorkspace(secondary.id);
    registry = await getWorkspaceRegistry();
    expect(registry.activeWorkspaceId).toBe(secondary.id);

    await removeWorkspace(secondary.id);
    registry = await getWorkspaceRegistry();
    expect(registry.activeWorkspaceId).toBe(primary.id);
  });
});
