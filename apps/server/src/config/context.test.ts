import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("resolveWorkspaceRoot", () => {
  const createdDirs: string[] = [];

  const makeTempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-context-"));
    createdDirs.push(dir);
    return dir;
  };

  const writeConfig = (dir: string) => {
    writeFileSync(join(dir, "hive.config.json"), CONFIG_CONTENT, "utf8");
  };

  beforeEach(() => {
    process.env.HIVE_WORKSPACE_ROOT = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreWorkspaceEnv();
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns the current directory when hive.config.json is present", () => {
    const workspace = makeTempDir();
    writeConfig(workspace);
    process.chdir(workspace);

    expect(resolveWorkspaceRoot()).toBe(workspace);
  });

  it("falls back to a nested hive directory when config exists there", () => {
    const workspace = makeTempDir();
    const nested = join(workspace, "hive");
    mkdirSync(nested, { recursive: true });
    writeConfig(nested);
    process.chdir(workspace);

    expect(resolveWorkspaceRoot()).toBe(nested);
  });

  it("applies the nested fallback when HIVE_WORKSPACE_ROOT points to the parent", () => {
    const workspace = makeTempDir();
    const nested = join(workspace, "hive");
    mkdirSync(nested, { recursive: true });
    writeConfig(nested);
    process.env.HIVE_WORKSPACE_ROOT = workspace;

    expect(resolveWorkspaceRoot()).toBe(nested);
  });
});

describe("loadHiveConfig cache invalidation", () => {
  const createdDirs: string[] = [];

  const makeTempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-context-cache-"));
    createdDirs.push(dir);
    return dir;
  };

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
    writeFileSync(
      join(dir, "hive.config.json"),
      JSON.stringify(config),
      "utf8"
    );
  };

  beforeEach(() => {
    process.env.HIVE_WORKSPACE_ROOT = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreWorkspaceEnv();
    clearHiveConfigCache();
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

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
