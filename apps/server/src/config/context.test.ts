import {
  mkdirSync as createDirSync,
  mkdtempSync as createTempDirSync,
  rmSync as removeDirSync,
  writeFileSync as writeTextFileSync,
} from "node:fs";
import { tmpdir as systemTmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearHiveConfigCache,
  loadHiveConfig,
  resolveWorkspaceRoot,
} from "./context";

const CONFIG_CONTENT = "{}\n";
const MTIME_SETTLE_DELAY_MS = 20;
const VALID_CONFIG_BASE = {
  promptSources: ["docs/prompts/**/*.md"],
  templates: {
    basic: {
      id: "basic",
      label: "Basic",
      type: "manual",
    },
  },
};

const originalCwd = process.cwd();
const originalWorkspaceEnv = process.env.HIVE_WORKSPACE_ROOT;

const restoreWorkspaceEnv = () => {
  if (typeof originalWorkspaceEnv === "undefined") {
    process.env.HIVE_WORKSPACE_ROOT = undefined;
    return;
  }
  process.env.HIVE_WORKSPACE_ROOT = originalWorkspaceEnv;
};

const cleanupDirs = (createdDirs: string[]) => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      removeDirSync(dir, { recursive: true, force: true });
    }
  }
};

const restoreContextTestState = (createdDirs: string[]) => {
  process.chdir(originalCwd);
  restoreWorkspaceEnv();
  cleanupDirs(createdDirs);
};

const makeTrackedTempDir = (createdDirs: string[], prefix: string) => {
  const dir = createTempDirSync(joinPath(systemTmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
};

const resetWorkspaceRootEnv = () => {
  process.env.HIVE_WORKSPACE_ROOT = undefined;
};

const installContextHooks = (
  createdDirs: string[],
  afterRestore?: () => void
) => {
  beforeEach(resetWorkspaceRootEnv);
  afterEach(() => {
    restoreContextTestState(createdDirs);
    afterRestore?.();
  });
};

describe("resolveWorkspaceRoot", () => {
  const createdDirs: string[] = [];

  const makeTempDir = () => makeTrackedTempDir(createdDirs, "hive-context-");

  const writeConfig = (dir: string) => {
    writeTextFileSync(
      joinPath(dir, "hive.config.json"),
      CONFIG_CONTENT,
      "utf8"
    );
  };

  installContextHooks(createdDirs);

  it("returns the current directory when hive.config.json is present", () => {
    const workspace = makeTempDir();
    writeConfig(workspace);
    process.chdir(workspace);

    expect(resolveWorkspaceRoot()).toBe(workspace);
  });

  it("falls back to a nested hive directory when config exists there", () => {
    const workspace = makeTempDir();
    const nested = createNestedHiveWorkspace(workspace, writeConfig);
    process.chdir(workspace);

    expect(resolveWorkspaceRoot()).toBe(nested);
  });

  it("applies the nested fallback when HIVE_WORKSPACE_ROOT points to the parent", () => {
    const workspace = makeTempDir();
    const nested = createNestedHiveWorkspace(workspace, writeConfig);
    process.env.HIVE_WORKSPACE_ROOT = workspace;

    expect(resolveWorkspaceRoot()).toBe(nested);
  });
});

describe("loadHiveConfig cache invalidation", () => {
  const createdDirs: string[] = [];

  const makeTempDir = () =>
    makeTrackedTempDir(createdDirs, "hive-context-cache-");

  const writeValidConfig = (dir: string, withSetupCommand: boolean) => {
    const config = {
      ...VALID_CONFIG_BASE,
      templates: {
        basic: {
          ...VALID_CONFIG_BASE.templates.basic,
          ...(withSetupCommand ? { setup: ["echo updated"] } : {}),
        },
      },
    };
    writeTextFileSync(
      joinPath(dir, "hive.config.json"),
      JSON.stringify(config),
      "utf8"
    );
  };

  installContextHooks(createdDirs, clearHiveConfigCache);

  it("reloads hive config after hive.config.json changes", async () => {
    const workspace = makeTempDir();
    writeValidConfig(workspace, false);

    const initial = await loadHiveConfig(workspace);
    const initialBasicTemplate = initial.templates.basic;
    expect(initialBasicTemplate).toBeDefined();
    expect(initialBasicTemplate?.setup).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, MTIME_SETTLE_DELAY_MS));
    writeValidConfig(workspace, true);

    const refreshed = await loadHiveConfig(workspace);
    const refreshedBasicTemplate = refreshed.templates.basic;
    expect(refreshedBasicTemplate).toBeDefined();
    expect(refreshedBasicTemplate?.setup).toEqual(["echo updated"]);
  });
});

const createNestedHiveWorkspace = (
  workspace: string,
  writeConfig: (dir: string) => void
) => {
  const nested = joinPath(workspace, "hive");
  createDirSync(nested, { recursive: true });
  writeConfig(nested);
  return nested;
};
