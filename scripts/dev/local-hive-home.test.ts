import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  resolveDefaultDevCellsRoot,
  resolveDefaultDevHiveHome,
  resolveWorkspaceRoot,
} from "./local-hive-home";
import { createTempDirFixture } from "./test-temp-dir";

const createTempDir = createTempDirFixture("hive-local-home-");

describe("local hive home helpers", () => {
  test("resolveWorkspaceRoot returns the workspace root when hive.config.json exists there", () => {
    const workspaceRoot = createWorkspace();

    expect(resolveWorkspaceRoot(workspaceRoot)).toBe(workspaceRoot);
  });

  test("resolveWorkspaceRoot falls back from apps/* directories to the workspace root", () => {
    const workspaceRoot = createWorkspace();
    const desktopDir = join(workspaceRoot, "apps", "desktop-electron");
    mkdirSync(desktopDir, { recursive: true });

    expect(resolveWorkspaceRoot(desktopDir)).toBe(workspaceRoot);
  });

  test("resolveWorkspaceRoot uses the closest apps segment for nested parent paths", () => {
    const parentRoot = createTempDir();
    const workspaceRoot = join(parentRoot, "apps", "hive-worktree");
    const desktopDir = join(workspaceRoot, "apps", "desktop-electron");

    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(join(workspaceRoot, "hive.config.json"), "{}\n");

    expect(resolveWorkspaceRoot(desktopDir)).toBe(workspaceRoot);
  });

  test("resolveWorkspaceRoot prefers nested hive directory when parent lacks config", () => {
    const parentRoot = createTempDir();
    const nestedWorkspace = join(parentRoot, "hive");
    mkdirSync(nestedWorkspace, { recursive: true });
    writeFileSync(join(nestedWorkspace, "hive.config.json"), "{}\n");

    expect(resolveWorkspaceRoot(parentRoot)).toBe(nestedWorkspace);
  });

  test("resolveDefaultDevHiveHome uses a workspace-local .hive/home path", () => {
    const workspaceRoot = createWorkspace();

    expect(resolveDefaultDevHiveHome(workspaceRoot)).toBe(
      join(workspaceRoot, ".hive", "home")
    );
  });

  test("resolveDefaultDevCellsRoot stays outside the workspace", () => {
    const workspaceRoot = createWorkspace();
    const stateHome = createTempDir();
    const cellsRoot = resolveDefaultDevCellsRoot(workspaceRoot, stateHome);
    const pathFromWorkspace = relative(workspaceRoot, cellsRoot);

    expect(pathFromWorkspace.startsWith(`..${sep}`)).toBe(true);
    expect(isAbsolute(pathFromWorkspace)).toBe(false);
    expect(
      cellsRoot.startsWith(`${join(stateHome, "hive", "dev-cells")}${sep}`)
    ).toBe(true);
    expect(resolveDefaultDevCellsRoot(workspaceRoot, stateHome)).toBe(
      cellsRoot
    );
  });

  test("resolveDefaultDevCellsRoot rejects state directories inside the workspace", () => {
    const workspaceRoot = createWorkspace();
    const containedStateHome = join(workspaceRoot, ".state");

    const cellsRoot = resolveDefaultDevCellsRoot(
      workspaceRoot,
      containedStateHome
    );

    expect(cellsRoot.startsWith(`${workspaceRoot}${sep}`)).toBe(false);
    expect(
      cellsRoot.startsWith(
        `${join(dirname(workspaceRoot), ".hive-dev-state", "hive", "dev-cells")}${sep}`
      )
    ).toBe(true);
  });

  test("resolveDefaultDevCellsRoot rejects symlinks into the workspace", () => {
    const workspaceRoot = createWorkspace();
    const containedStateHome = join(workspaceRoot, ".state");
    const stateHomeLink = join(createTempDir(), "state-link");
    mkdirSync(containedStateHome);
    symlinkSync(containedStateHome, stateHomeLink, "dir");

    const cellsRoot = resolveDefaultDevCellsRoot(workspaceRoot, stateHomeLink);

    expect(isExternalCellsRoot(cellsRoot, workspaceRoot, stateHomeLink)).toBe(
      true
    );
  });

  test("resolveDefaultDevCellsRoot resolves symlink ancestors for missing state directories", () => {
    const workspaceRoot = createWorkspace();
    const stateHomeLink = join(createTempDir(), "state-link");
    symlinkSync(workspaceRoot, stateHomeLink, "dir");

    const cellsRoot = resolveDefaultDevCellsRoot(
      workspaceRoot,
      join(stateHomeLink, "missing", "state")
    );

    expect(isExternalCellsRoot(cellsRoot, workspaceRoot, stateHomeLink)).toBe(
      true
    );
  });

  test("resolveDefaultDevCellsRoot rejects nested state symlinks into the workspace", () => {
    const workspaceRoot = createWorkspace();
    const stateHome = createTempDir();
    symlinkSync(workspaceRoot, join(stateHome, "hive"), "dir");

    const cellsRoot = resolveDefaultDevCellsRoot(workspaceRoot, stateHome);

    expect(isExternalCellsRoot(cellsRoot, workspaceRoot, stateHome)).toBe(true);
  });

  test("resolveDefaultDevCellsRoot treats blank state directories as unset", () => {
    const workspaceRoot = createWorkspace();

    const cellsRoot = resolveDefaultDevCellsRoot(workspaceRoot, "   ");

    expect(cellsRoot.startsWith(`${workspaceRoot}${sep}`)).toBe(false);
    expect(cellsRoot).toContain(`${sep}hive${sep}dev-cells${sep}`);
  });
});

function createWorkspace() {
  const workspaceRoot = createTempDir();
  writeFileSync(join(workspaceRoot, "hive.config.json"), "{}\n");
  return workspaceRoot;
}

function isExternalCellsRoot(
  cellsRoot: string,
  workspaceRoot: string,
  rejectedRoot: string
) {
  return !(
    cellsRoot.startsWith(`${rejectedRoot}${sep}`) ||
    cellsRoot.startsWith(`${workspaceRoot}${sep}`)
  );
}
