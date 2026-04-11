import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveDefaultDevHiveHome,
  resolveWorkspaceRoot,
} from "./local-hive-home";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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
});

function createWorkspace() {
  const workspaceRoot = createTempDir();
  writeFileSync(join(workspaceRoot, "hive.config.json"), "{}\n");
  return workspaceRoot;
}

function createTempDir() {
  const directory = mkdtempSync(join(tmpdir(), "hive-local-home-"));
  tempDirectories.push(directory);
  return directory;
}
